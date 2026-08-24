FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile --ignore-scipts

COPY . .

RUN bun run build

FROM oven/bun:1-alpine AS runner

RUN apk add --no-cache wget ca-certificates

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=bun:bun /app/build ./build
COPY --from=builder --chown=bun:bun /app/package.json ./
COPY --from=builder --chown=bun:bun /app/drizzle/ /app/drizzle
COPY --from=builder --chown=bun:bun /app/drizzle.config.ts /app/drizzle.config.ts

EXPOSE 3000

ENV HOST=0.0.0.0
ENV PORT=3000
ENV BODY_SIZE_LIMIT=Infinity
ENV APP_ENV=production
ENV ORIGIN=http://localhost:3000
ENV STORAGE_BASE_PATH=/app/data

RUN mkdir -p /app/data
RUN chown -R bun:bun /app/data

VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://0.0.0.0:3000/api/health || exit 1

USER bun

CMD ["bun", "run", "/app/build/index.js"]
