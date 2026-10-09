# syntax=docker/dockerfile:1.7
# Immagini di TripShare:
#   --target api  → API e worker (Node)
#   --target web  → Caddy con il frontend compilato (HTTPS automatico)

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
ARG APP_VERSION=dev
COPY . .
RUN pnpm --filter @tripshare/api build && pnpm --filter @tripshare/web build
# Cartella autonoma con le sole dipendenze di produzione dell'API.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @tripshare/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r packages/db/drizzle /out/drizzle \
 && rm -rf /out/src /out/test /out/*.config.ts /out/tsconfig.json

FROM node:${NODE_VERSION}-alpine AS api
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=3000 MIGRATIONS_DIR=/app/drizzle APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM caddy:2.10-alpine AS web
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
