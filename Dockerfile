FROM oven/bun:1-alpine AS deps-base

WORKDIR /app

COPY package.json bun.lock* /app/

FROM deps-base AS deps

RUN bun install --frozen-lockfile --ignore-scripts

FROM  deps-base AS prod-deps

RUN bun install --production --frozen-lockfile --ignore-scripts

FROM deps AS app-builder

ENV BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1

COPY . .

ARG APP_VERSION

ENV APP_VERSION=${APP_VERSION}

COPY --from=deps /app/node_modules /app/node_modules

RUN bun run build:app

FROM oven/bun:1-alpine AS app


RUN apk add --no-cache wget ca-certificates su-exec

WORKDIR /app

COPY --from=prod-deps --chown=bun:bun /app/node_modules /app/node_modules
COPY --from=app-builder --chown=bun:bun /app/build /app/build
COPY --from=app-builder --chown=bun:bun /app/package.json /app/
COPY --from=app-builder --chown=bun:bun /app/drizzle/ /app/drizzle
COPY --from=app-builder --chown=bun:bun /app/drizzle.config.ts /app/drizzle.config.ts
COPY tools/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENV BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1
ENV NODE_ENV=production
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

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "run", "/app/build/index.js"]

FROM deps AS agent-builder

ARG APP_VERSION

ENV BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1
ENV APP_VERSION=${APP_VERSION}

WORKDIR /app

RUN apk add --no-cache wget ca-certificates

COPY --from=deps /app/node_modules /app/node_modules

COPY packages/agent /app/packages/agent
COPY tsconfig.json /app/tsconfig.json
COPY package.json /app/package.json

ARG TARGETARCH
RUN case "$TARGETARCH" in \
    amd64) BUN_TARGET=bun-linux-x64-musl ;; \
    arm64) BUN_TARGET=bun-linux-arm64-musl ;; \
    *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    bun build /app/packages/agent/index.ts --compile --target="$BUN_TARGET" --external cpu-features --minify --outfile /out/homerun-agent

FROM alpine:3 AS agent

RUN apk add --no-cache ca-certificates wget libstdc++ libgcc

COPY --from=agent-builder /out/homerun-agent /usr/local/bin/homerun-agent

ENV BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1
ENV PORT=7420
ENV DOCKER_SOCKET_PATH=/var/run/docker.sock

EXPOSE 7420

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://0.0.0.0:7420/v1/health || exit 1

ENTRYPOINT ["/usr/local/bin/homerun-agent"]

FROM deps AS docs-builder

COPY . .

COPY --from=deps /app/node_modules /app/node_modules

RUN mkdir -p .svelte-kit && echo '{"compilerOptions":{}}' > .svelte-kit/tsconfig.json

RUN cp openapi.json packages/docs/static/openapi.json

RUN cd packages/docs && ../../node_modules/.bin/svelte-kit sync && ../../node_modules/.bin/vite build

FROM nginx:latest-alpine AS docs

COPY --from=docs-builder /app/packages/docs/build /usr/share/nginx/html

COPY packages/docs/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1
