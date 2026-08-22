FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY agent ./agent
COPY tsconfig.json ./tsconfig.json

ARG TARGETARCH
RUN case "$TARGETARCH" in \
    amd64) BUN_TARGET=bun-linux-x64 ;; \
    arm64) BUN_TARGET=bun-linux-arm64 ;; \
    *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    bun build ./agent/index.ts --compile --target="$BUN_TARGET" --minify --outfile /out/homerun-agent

FROM debian:bookworm-slim AS runner

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/homerun-agent /usr/local/bin/homerun-agent

# Not set by default : the agent generates and persists its own token (see
# config.ts's tokenFile) on first boot when AGENT_TOKEN isn't provided,
# logged to stdout so `docker logs` shows it. Set AGENT_TOKEN explicitly to
# pin it instead (e.g. via a compose .env file).
ENV PORT=7420
ENV DOCKER_SOCKET_PATH=/var/run/docker.sock

EXPOSE 7420

ENTRYPOINT ["/usr/local/bin/homerun-agent"]
