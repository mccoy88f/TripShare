import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyRequest } from 'fastify';
import { tripDocumentJsonSchema } from '@tripshare/shared/trip-format';
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
