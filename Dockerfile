FROM oven/bun:1.4.2-alpine AS deps-base

ENV BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1

WORKDIR /app

COPY package.json bun.lock* /app/
COPY patches /app/patches

FROM deps-base AS deps

RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS app-builder

COPY . .

COPY --from=deps /app/node_modules /app/node_modules

RUN bun run build:app

# The svelte-smol adapter compiles the app to a single standalone binary
# (`build/server`) that bundles every JS dependency, so the runtime image
# needs no `node_modules` and no Bun runtime to serve. It stays on
# `oven/bun:1.4.2-alpine` only because the binary is musl-linked (compiled on the
# Alpine builder above) and entrypoint.sh relies on this image's baked-in
# `bun` user plus `su-exec` / busybox `addgroup`.
FROM oven/bun:1.4.2-alpine AS app

RUN apk add --no-cache ca-certificates su-exec

WORKDIR /app

COPY --from=app-builder --chown=bun:bun /app/build /app/build
COPY --from=app-builder --chown=bun:bun /app/drizzle/ /app/drizzle
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

ARG HOMERUN_APP_VERSION=""
ENV HOMERUN_APP_VERSION=$HOMERUN_APP_VERSION

RUN mkdir -p /app/data /app/traefik-dynamic && chown -R bun:bun /app/data /app/traefik-dynamic

VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD ["/app/build/healthcheck"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/app/build/server"]

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS agent-builder

WORKDIR /src

COPY go.mod ./
COPY cmd/agent ./cmd/agent
COPY internal ./internal
COPY package.json ./

ARG TARGETOS
ARG TARGETARCH
RUN VERSION="$(sed -n 's/^[[:space:]]*"version": "\(.*\)",*$/\1/p' package.json)"; \
    CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -trimpath \
    -ldflags "-s -w -X github.com/orochibraru/homerun/internal/buildinfo.Version=${VERSION}" \
    -o /out/homerun-agent ./cmd/agent

FROM alpine:3 AS agent

RUN apk add --no-cache ca-certificates wget

COPY --from=agent-builder /out/homerun-agent /usr/local/bin/homerun-agent

ENV PORT=7420
ENV DOCKER_SOCKET_PATH=/var/run/docker.sock

EXPOSE 7420

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD ["sh", "-c", "wget --no-verbose --tries=1 --spider http://0.0.0.0:7420/v1/health || exit 1"]

ENTRYPOINT ["/usr/local/bin/homerun-agent"]
