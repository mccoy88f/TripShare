import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { Zip, ZipPassThrough } from 'fflate';
import sharp from 'sharp';
import { readFile, stat } from 'node:fs/promises';
import { bookingTicket, expense, memory, trip, tripMember, user } from '@tripshare/db';
import { TICKET_CODE_FORMATS } from './routers/tickets.js';
import { tripDocumentJsonSchema } from '@tripshare/shared/trip-format';
import { notifyTrip } from './services/events.js';
import {
  MAX_VIDEO_SECONDS,
  MediaError,
  processPhoto,
  probeVideo,
  videoPoster,
  withTempFile,
  type MediaMeta,
} from './services/media.js';
import { processVideoMemory, tripForDate, visibleTo } from './services/memories.js';
import { registerPushDelivery } from './services/push.js';
import { createRealtime, subscribeUser } from './services/realtime.js';
import { requireMember } from './services/trips.js';
import { appRouter, type AppRouter } from './routers/index.js';
import type { AppServices, Context } from './trpc/init.js';

/** Nome di un ricordo scaricato: data e ora (UTC) più un pezzo dell'identificativo. */
function memoryFileName(
  row: { id: string; kind: string; takenAt: Date | null; createdAt: Date },
  photoAsJpeg: boolean,
) {
  const d = (row.takenAt ?? row.createdAt).toISOString();
  const stamp = `${d.slice(0, 10).replaceAll('-', '')}-${d.slice(11, 16).replace(':', '')}`;
  const ext = row.kind === 'video' ? 'mp4' : photoAsJpeg ? 'jpg' : 'webp';
  return `ricordo-${stamp}-${row.id.slice(0, 6)}.${ext}`;
}

function toHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.append(key, String(value));
  }
  return headers;
}

export async function buildServer(
  services: AppServices,
  options: { logger?: boolean | object } = {},
) {
  const { env, auth } = services;
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  // In produzione web e API hanno la stessa origine dietro Caddy; CORS serve solo in sviluppo.
  await app.register(cors, { origin: env.trustedOrigins, credentials: true });

  app.get('/api/health', { logLevel: 'silent' }, async () => ({ status: 'ok' }));

  const realtime = createRealtime(services.redis);
  app.addHook('onClose', async () => realtime.close());
  const stopPush = registerPushDelivery({
    db: services.db,
    sender: services.pushSender,
    queue: services.notifyQueue,
    log: (msg) => app.log.warn(msg),
  });
  app.addHook('onClose', async () => stopPush());

  /** Flusso di aggiornamenti in tempo reale (SSE) per l'utente collegato. */
  app.get('/api/events', { logLevel: 'silent' }, async (req, reply) => {
    const session = await auth.api.getSession({ headers: toHeaders(req) });
    if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Senza questo alcuni proxy trattengono i dati invece di inoltrarli subito.
      'x-accel-buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    const unsubscribe = subscribeUser(session.user.id, (message) => {
      const { users: _users, notify, ...rest } = message;
      void _users;
      res.write(
        `event: change\ndata: ${JSON.stringify({ ...rest, notify: notify.includes(session.user.id) })}\n\n`,
      );
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
    res.on('error', cleanup);
  });

  app.get('/api/trip-format/v1/schema.json', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    return tripDocumentJsonSchema();
  });

  // Better Auth lavora con Request/Response standard: si convertono quelle di Fastify.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    async handler(req, reply) {
      const url = new URL(req.url, env.appOrigin);
      const request = new Request(url, {
        method: req.method,
        headers: toHeaders(req),
        body: req.method === 'GET' || req.body === undefined ? undefined : JSON.stringify(req.body),
      });
      const response = await auth.handler(request);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      for (const cookie of response.headers.getSetCookie()) reply.header('set-cookie', cookie);
      return reply.send(response.body ? await response.text() : null);
    },
  });

  await app.register(multipart, { limits: { files: 1, fileSize: 50 * 1024 * 1024 } });

  const sessionOf = (req: FastifyRequest) => auth.api.getSession({ headers: toHeaders(req) });

  /** Legge l'immagine dalla richiesta multipart rispettando il limite impostato nel pannello. */
  async function readImage(
    req: FastifyRequest,
  ): Promise<Buffer | { error: string; status: number }> {
    const maxMb = await services.settings.get('uploads.maxMb');
    const file = await req.file({ limits: { fileSize: maxMb * 1024 * 1024 } });
    if (!file) return { error: 'NO_FILE', status: 400 };
    if (!file.mimetype.startsWith('image/')) return { error: 'NOT_AN_IMAGE', status: 415 };
    const buffer = await file.toBuffer().catch(() => null);
    if (!buffer || file.file.truncated) return { error: 'FILE_TOO_LARGE', status: 413 };
    return buffer;
  }

  if (services.storage) {
    const storage = services.storage;

    app.get<{ Params: { name: string } }>(
      '/api/files/:name',
      { logLevel: 'warn' },
      async (req, reply) => {
        const data = await storage.read(req.params.name);
        if (!data) return reply.status(404).send({ error: 'NOT_FOUND' });
        reply.header('content-type', 'image/webp');
        reply.header('cache-control', 'public, max-age=31536000, immutable');
        return reply.send(data);
      },
    );

    app.post('/api/me/avatar', async (req, reply) => {
      const session = await sessionOf(req);
      if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
      const image = await readImage(req);
      if (!Buffer.isBuffer(image)) return reply.status(image.status).send({ error: image.error });
      const url = await storage.saveImage(image, 'avatar').catch(() => null);
      if (!url) return reply.status(422).send({ error: 'INVALID_IMAGE' });
      const [previous] = await services.db
        .select({ image: user.image })
        .from(user)
        .where(eq(user.id, session.user.id));
      await services.db
        .update(user)
        .set({ image: url, updatedAt: new Date() })
        .where(eq(user.id, session.user.id));
      await storage.removeByUrl(previous?.image);
      return { url };
    });

    /** Foto di un luogo caricata dal dispositivo; il programma la collega al luogo. */
    app.post<{ Params: { id: string } }>('/api/trips/:id/place-photo', async (req, reply) => {
      const session = await sessionOf(req);
      if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
      try {
        await requireMember(services.db, req.params.id, session.user.id, 'editor');
      } catch {
        return reply.status(404).send({ error: 'TRIP_NOT_FOUND' });
      }
      const image = await readImage(req);
      if (!Buffer.isBuffer(image)) return reply.status(image.status).send({ error: image.error });
      const url = await storage.saveImage(image, 'place').catch(() => null);
      if (!url) return reply.status(422).send({ error: 'INVALID_IMAGE' });
      return { url };
    });

    const TICKET_TYPES: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/vnd.apple.pkpass': 'pkpass',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/gif': 'gif',
    };

    /** Caricamento di un biglietto (PDF, immagine o Apple Wallet) per una prenotazione. */
    app.post<{ Params: { id: string } }>('/api/trips/:id/tickets', async (req, reply) => {
      const session = await sessionOf(req);
      if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
      try {
        await requireMember(services.db, req.params.id, session.user.id, 'editor');
      } catch {
        return reply.status(404).send({ error: 'TRIP_NOT_FOUND' });
      }
      const maxMb = await services.settings.get('uploads.maxMb');
      const file = await req.file({ limits: { fileSize: maxMb * 1024 * 1024 } });
      if (!file) return reply.status(400).send({ error: 'NO_FILE' });
      const isPkpass = file.filename.toLowerCase().endsWith('.pkpass');
      const mime = isPkpass ? 'application/vnd.apple.pkpass' : file.mimetype;
      const ext = TICKET_TYPES[mime];
      if (!ext) return reply.status(415).send({ error: 'UNSUPPORTED_FILE' });
      const buffer = await file.toBuffer().catch(() => null);
      if (!buffer || file.file.truncated)
        return reply.status(413).send({ error: 'FILE_TOO_LARGE' });

      const field = (name: string) => {
        const f = file.fields[name] as { value?: unknown } | undefined;
        return typeof f?.value === 'string' && f.value.trim() ? f.value.trim() : undefined;
      };
      const bookingId = field('bookingId');
      if (!bookingId || bookingId.length > 64)
        return reply.status(400).send({ error: 'NO_BOOKING' });
      const memberId = field('memberId');
      if (memberId) {
        const [m] = await services.db
          .select({ id: tripMember.id })
          .from(tripMember)
          .where(and(eq(tripMember.id, memberId), eq(tripMember.tripId, req.params.id)));
        if (!m) return reply.status(400).send({ error: 'UNKNOWN_MEMBER' });
      }
      const codeFormat = field('codeFormat');
      const format =
        codeFormat && (TICKET_CODE_FORMATS as readonly string[]).includes(codeFormat)
          ? codeFormat
          : null;

      const storageName = await storage.savePrivate(buffer, ext);
      const [row] = await services.db
        .insert(bookingTicket)
        .values({
          tripId: req.params.id,
          bookingId,
          memberId: memberId ?? null,
          label: field('label')?.slice(0, 120) ?? null,
          fileName: file.filename.slice(0, 200),
          storageName,
          mimeType: mime,
          size: buffer.length,
          codeFormat: format,
          codeValue: format ? (field('codeValue')?.slice(0, 4000) ?? null) : null,
          createdBy: session.user.id,
        })
        .returning({ id: bookingTicket.id });
      await notifyTrip(services.db, {
        tripId: req.params.id,
        actorUserId: session.user.id,
        type: 'ticket.added',
        entityId: bookingId,
        data: { title: field('label')?.slice(0, 120) },
      });
      return { id: row!.id };
    });

    app.get<{ Params: { id: string; ticketId: string } }>(
      '/api/trips/:id/tickets/:ticketId/file',
      async (req, reply) => {
        const session = await sessionOf(req);
        if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
        try {
          await requireMember(services.db, req.params.id, session.user.id);
        } catch {
          return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        const [ticket] = await services.db
          .select()
          .from(bookingTicket)
          .where(
            and(eq(bookingTicket.id, req.params.ticketId), eq(bookingTicket.tripId, req.params.id)),
          );
        const data = ticket?.storageName ? await storage.readPrivate(ticket.storageName) : null;
        if (!ticket || !data) return reply.status(404).send({ error: 'NOT_FOUND' });
        reply.header('content-type', ticket.mimeType ?? 'application/octet-stream');
        reply.header('cache-control', 'private, max-age=86400');
        reply.header(
          'content-disposition',
          `inline; filename*=UTF-8''${encodeURIComponent(ticket.fileName ?? 'ticket')}`,
        );
        reply.header('x-content-type-options', 'nosniff');
        return reply.send(data);
      },
    );

    const VIDEO_EXT: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
      'video/x-m4v': 'm4v',
      'video/3gpp': '3gp',
      'video/x-matroska': 'mkv',
    };

    /** Caricamento di un ricordo (foto o video): data e posizione si leggono dal file. */
    app.post('/api/memories', async (req, reply) => {
      const session = await sessionOf(req);
      if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
      const userId = session.user.id;
      const maxPhotoMb = await services.settings.get('uploads.maxMb');
      const maxVideoMb = await services.settings.get('memories.maxVideoMb');
      const file = await req.file({
        limits: { fileSize: Math.max(maxPhotoMb, maxVideoMb) * 1024 * 1024 },
      });
      if (!file) return reply.status(400).send({ error: 'NO_FILE' });
      const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
      const isVideo =
        file.mimetype.startsWith('video/') ||
        (file.mimetype === 'application/octet-stream' &&
          ['mp4', 'mov', 'm4v', 'webm', '3gp'].includes(ext));
      const isPhoto = file.mimetype.startsWith('image/');
      if (!isVideo && !isPhoto) return reply.status(415).send({ error: 'UNSUPPORTED_MEDIA' });
      const buffer = await file.toBuffer().catch(() => null);
      if (!buffer || file.file.truncated)
        return reply.status(413).send({ error: 'FILE_TOO_LARGE' });
      if (buffer.length > (isVideo ? maxVideoMb : maxPhotoMb) * 1024 * 1024)
        return reply.status(413).send({ error: 'FILE_TOO_LARGE' });

      const field = (name: string) => {
        const f = file.fields[name] as { value?: unknown } | undefined;
        return typeof f?.value === 'string' && f.value.trim() ? f.value.trim() : undefined;
      };
      // "none": ricordo solo personale, senza collegamento automatico a un viaggio.
      const noTrip = field('tripId') === 'none';
      let tripId = noTrip ? null : (field('tripId') ?? null);
      if (tripId) {
        try {
          await requireMember(services.db, tripId, userId);
        } catch {
          return reply.status(404).send({ error: 'TRIP_NOT_FOUND' });
        }
      }

      try {
        let meta: MediaMeta;
        let storageName: string;
        let thumb: Buffer;
        let mimeType: string;
        let size: number;
        if (isVideo) {
          const videoExt = VIDEO_EXT[file.mimetype] ?? (ext || 'mp4');
          const probed = await withTempFile(
            buffer,
            videoExt.replace(/[^a-z0-9]/g, '') || 'mp4',
            async (path) => {
              const m = await probeVideo(path);
              if ((m.durationSec ?? 0) > MAX_VIDEO_SECONDS + 1)
                throw new MediaError('VIDEO_TOO_LONG');
              return { meta: m, poster: await videoPoster(path, m.durationSec) };
            },
          );
          meta = probed.meta;
          thumb = probed.poster;
          storageName = await storage.savePrivate(buffer, videoExt);
          mimeType = 'video/mp4';
          size = buffer.length;
        } else {
          const photo = await processPhoto(buffer);
          meta = photo.meta;
          thumb = photo.thumb;
          storageName = await storage.savePrivate(photo.full, 'webp');
          mimeType = 'image/webp';
          size = photo.full.length;
        }
        const thumbName = await storage.savePrivate(thumb, 'webp');

        // Se il telefono o il browser hanno già letto data e posizione, valgono quelli.
        const num = (name: string) => {
          const v = Number(field(name));
          return field(name) !== undefined && Number.isFinite(v) ? v : null;
        };
        const sentAt = field('takenAt') ? new Date(field('takenAt')!) : null;
        const takenAt = meta.takenAt ?? (sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null);
        const lat = num('lat');
        const lon = num('lon');
        const hasPoint =
          lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
        if (!tripId && !noTrip && takenAt) tripId = await tripForDate(services.db, userId, takenAt);
        const shared = field('shared') === 'false' ? false : !!tripId;

        const [row] = await services.db
          .insert(memory)
          .values({
            userId,
            tripId,
            kind: isVideo ? 'video' : 'photo',
            storageName,
            thumbName,
            mimeType,
            size,
            width: meta.width,
            height: meta.height,
            durationSec: meta.durationSec,
            takenAt,
            // Il file ha la precedenza; ciò che si manda vale come ripiego.
            lat: meta.lat ?? (hasPoint ? lat : null),
            lon: meta.lon ?? (hasPoint ? lon : null),
            caption: field('caption')?.slice(0, 1000) ?? null,
            shared,
            status: isVideo ? 'processing' : 'ready',
          })
          .returning({ id: memory.id });
        if (isVideo) {
          if (services.mediaQueue) {
            await services.mediaQueue.add(
              'video',
              { memoryId: row!.id },
              { attempts: 2, removeOnComplete: true, removeOnFail: 50 },
            );
          } else {
            // Senza coda (test, sviluppo) si ricodifica subito.
            await processVideoMemory(
              { db: services.db, storage, log: (m) => app.log.warn(m) },
              row!.id,
            ).catch(() => undefined);
          }
        }
        if (tripId && shared) {
          await notifyTrip(services.db, {
            tripId,
            actorUserId: userId,
            type: 'memory.added',
            entityId: row!.id,
          });
        }
        return { id: row!.id };
      } catch (err) {
        if (err instanceof MediaError)
          return reply.status(err.code === 'VIDEO_TOO_LONG' ? 413 : 415).send({ error: err.code });
        throw err;
      }
    });

    /** Più ricordi in un unico file ZIP (si scarica a pezzi, senza tenerli tutti in memoria). */
    app.get<{ Querystring: { ids?: string } }>('/api/memories/zip', async (req, reply) => {
      const session = await sessionOf(req);
      if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
      const ids = [
        ...new Set((req.query.ids ?? '').split(',').filter((i) => /^[0-9a-f-]{36}$/.test(i))),
      ].slice(0, 200);
      if (ids.length === 0) return reply.status(400).send({ error: 'NO_IDS' });
      const rows = await services.db
        .select()
        .from(memory)
        .where(and(inArray(memory.id, ids), visibleTo(session.user.id)));
      if (rows.length === 0) return reply.status(404).send({ error: 'NOT_FOUND' });
      rows.sort(
        (a, b) => (a.takenAt ?? a.createdAt).getTime() - (b.takenAt ?? b.createdAt).getTime(),
      );

      const out = new PassThrough();
      const write = async (chunk: Uint8Array) => {
        if (!out.write(chunk)) await once(out, 'drain');
      };
      const zip = new Zip((err, chunk, final) => {
        if (err) return void out.destroy(err);
        void write(chunk).then(() => final && out.end());
      });
      void (async () => {
        try {
          for (const [i, row] of rows.entries()) {
            const path = storage.privatePath(row.storageName);
            if (!path) continue;
            const entry = new ZipPassThrough(
              `${String(i + 1).padStart(3, '0')}-${memoryFileName(row, true)}`,
            );
            zip.add(entry);
            if (row.kind === 'photo') {
              entry.push(
                await sharp(await readFile(path))
                  .jpeg({ quality: 90 })
                  .toBuffer(),
                true,
              );
            } else {
              for await (const chunk of createReadStream(path)) entry.push(chunk as Buffer);
              entry.push(new Uint8Array(0), true);
            }
          }
          zip.end();
        } catch (err) {
          out.destroy(err as Error);
        }
      })();
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', 'attachment; filename="ricordi.zip"');
      reply.header('cache-control', 'no-store');
      return reply.send(out);
    });

    /** Legge il file (o l'anteprima) di un ricordo, a pezzi per i video (Range). */
    app.get<{ Params: { id: string }; Querystring: { v?: string; download?: string } }>(
      '/api/memories/:id/file',
      async (req, reply) => {
        const session = await sessionOf(req);
        if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
        if (!/^[0-9a-f-]{36}$/.test(req.params.id))
          return reply.status(404).send({ error: 'NOT_FOUND' });
        const [row] = await services.db
          .select()
          .from(memory)
          .where(and(eq(memory.id, req.params.id), visibleTo(session.user.id)));
        const name = req.query.v === 'thumb' ? row?.thumbName : row?.storageName;
        const path = name ? storage.privatePath(name) : null;
        if (!row || !path) return reply.status(404).send({ error: 'NOT_FOUND' });
        const info = await stat(path).catch(() => null);
        if (!info) return reply.status(404).send({ error: 'NOT_FOUND' });
        const type = req.query.v === 'thumb' ? 'image/webp' : row.mimeType;
        if (req.query.download === '1')
          reply.header(
            'content-disposition',
            `attachment; filename="${memoryFileName(row, req.query.v === 'jpg')}"`,
          );
        // Foto in JPEG: la si apre ovunque (WebP non sempre si importa nella galleria).
        if (req.query.v === 'jpg' && row.kind === 'photo') {
          const jpg = await sharp(await readFile(path))
            .jpeg({ quality: 90 })
            .toBuffer();
          reply.header('content-type', 'image/jpeg');
          reply.header('cache-control', 'private, max-age=86400');
          reply.header('x-content-type-options', 'nosniff');
          return reply.send(jpg);
        }
        reply.header('content-type', type);
        reply.header('accept-ranges', 'bytes');
        reply.header('cache-control', 'private, max-age=86400');
        reply.header('x-content-type-options', 'nosniff');
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (range && (range[1] || range[2])) {
          let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
          let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
          start = Math.max(0, start);
          end = Math.min(end, info.size - 1);
          if (start > end) {
            reply.header('content-range', `bytes */${info.size}`);
            return reply.status(416).send();
          }
          reply.status(206);
          reply.header('content-range', `bytes ${start}-${end}/${info.size}`);
          reply.header('content-length', end - start + 1);
          return reply.send(createReadStream(path, { start, end }));
        }
        reply.header('content-length', info.size);
        return reply.send(createReadStream(path));
      },
    );

    const AI_FILE_TYPES: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };

    /** Foto o PDF di uno scontrino o di una conferma di prenotazione, da far leggere all'AI. */
    app.post<{ Params: { id: string } }>('/api/trips/:id/ai-files', async (req, reply) => {
      const session = await sessionOf(req);
      if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
      try {
        await requireMember(services.db, req.params.id, session.user.id, 'editor');
      } catch {
        return reply.status(404).send({ error: 'TRIP_NOT_FOUND' });
      }
      const maxMb = await services.settings.get('uploads.maxMb');
      const file = await req.file({ limits: { fileSize: maxMb * 1024 * 1024 } });
      if (!file) return reply.status(400).send({ error: 'NO_FILE' });
      const ext = AI_FILE_TYPES[file.mimetype];
      if (!ext) return reply.status(415).send({ error: 'UNSUPPORTED_FILE' });
      const buffer = await file.toBuffer().catch(() => null);
      if (!buffer || file.file.truncated)
        return reply.status(413).send({ error: 'FILE_TOO_LARGE' });
      const name = await storage.savePrivate(buffer, ext);
      return { file: name, mime: file.mimetype };
    });

    /** Scontrino allegato a una spesa del viaggio. */
    app.get<{ Params: { id: string; name: string } }>(
      '/api/trips/:id/receipts/:name',
      async (req, reply) => {
        const session = await sessionOf(req);
        if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
        try {
          await requireMember(services.db, req.params.id, session.user.id);
        } catch {
          return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        const [row] = await services.db
          .select({ id: expense.id })
          .from(expense)
          .where(and(eq(expense.tripId, req.params.id), eq(expense.receipt, req.params.name)));
        const data = row ? await storage.readPrivate(req.params.name) : null;
        if (!data) return reply.status(404).send({ error: 'NOT_FOUND' });
        const ext = req.params.name.split('.').pop()!;
        const mime =
          Object.entries(AI_FILE_TYPES).find(([, e]) => e === ext)?.[0] ??
          'application/octet-stream';
        reply.header('content-type', mime);
        reply.header('cache-control', 'private, max-age=86400');
        reply.header('x-content-type-options', 'nosniff');
        return reply.send(data);
      },
    );

    app.post<{ Params: { id: string } }>('/api/trips/:id/cover', async (req, reply) => {
      const session = await sessionOf(req);
      if (!session) return reply.status(401).send({ error: 'UNAUTHORIZED' });
      try {
        await requireMember(services.db, req.params.id, session.user.id, 'editor');
      } catch {
        return reply.status(404).send({ error: 'TRIP_NOT_FOUND' });
      }
      const image = await readImage(req);
      if (!Buffer.isBuffer(image)) return reply.status(image.status).send({ error: image.error });
      const url = await storage.saveImage(image, 'cover').catch(() => null);
      if (!url) return reply.status(422).send({ error: 'INVALID_IMAGE' });
      const [previous] = await services.db
        .select({ coverImage: trip.coverImage })
        .from(trip)
        .where(and(eq(trip.id, req.params.id)));
      await services.db
        .update(trip)
        .set({ coverImage: url, coverCredit: null, updatedAt: new Date() })
        .where(eq(trip.id, req.params.id));
      await storage.removeByUrl(previous?.coverImage);
      return { url };
    });
  }

  await app.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      async createContext({ req }): Promise<Context> {
        const session = await auth.api.getSession({ headers: toHeaders(req) });
        return { ...services, session, ip: req.ip };
      },
      onError({ error, path }) {
        if (error.code === 'INTERNAL_SERVER_ERROR')
          app.log.error({ err: error, path }, 'tRPC error');
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });

  return app;
}
