# syntax=docker/dockerfile:1
#
# Node version below should track .nvmrc.

FROM node:24.21.0-alpine AS base
WORKDIR /app

# ---- dependencies (its own stage/layer so `npm ci` is only re-run when the
# manifest changes, not on every source edit) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime ----
# Nitro's node-server preset (see vite.config.ts) produces a self-contained
# .output/ with its own vendored node_modules for the handful of
# dependencies it can't inline — nothing further to install here.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/.output ./.output

RUN addgroup -S app && adduser -S app -G app
USER app

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/" || exit 1

CMD ["node", ".output/server/index.mjs"]
