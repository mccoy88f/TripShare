import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { trip, user } from '@tripshare/db';
import { tripDocumentJsonSchema } from '@tripshare/shared/trip-format';
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
        .set({ coverImage: url, updatedAt: new Date() })
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
