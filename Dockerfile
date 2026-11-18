# APP PALESTRA — immagine unica: API Fastify + PWA compilata (stessa origine), migrazioni all'avvio.
# Usata identica in TEST e in produzione: cambiano solo variabili d'ambiente e risorse collegate.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
# postgresql-client 16 (pg_dump/pg_restore compatibili con il server), age (cifratura backup), rclone (copia off-site)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini age rclone \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/server/assets server/assets
COPY --from=build /app/web/dist web/dist
COPY deploy deploy
RUN chmod +x deploy/*.sh
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIST=/app/web/dist STORAGE_DIR=/data/photos BACKUP_DIR=/data/backups
EXPOSE 3000
# /data va montato come disco persistente del provider (foto private + copie locali dei backup cifrati)
ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/entrypoint.sh"]
