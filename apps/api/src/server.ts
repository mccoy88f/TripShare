import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { bookingTicket, expense, trip, tripMember, user } from '@tripshare/db';
import { TICKET_CODE_FORMATS } from './routers/tickets.js';
import { tripDocumentJsonSchema } from '@tripshare/shared/trip-format';
import { notifyTrip } from './services/events.js';
import { registerPushDelivery } from './services/push.js';
import { createRealtime, subscribeUser } from './services/realtime.js';
import { requireMember } from './services/trips.js';
import { appRouter, type AppRouter } from './routers/index.js';
import type { AppServices, Context } from './trpc/init.js';

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
