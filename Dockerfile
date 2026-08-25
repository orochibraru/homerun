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

# No USER here, deliberately: entrypoint.sh needs to start as root to fix up
# Docker-socket group access (see its own header comment for why), then
# su-exec's into `bun` itself for the actual process, never running the app
# as root.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "run", "/app/build/index.js"]

FROM deps AS agent-builder

ARG APP_VERSION

ENV BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1
ENV APP_VERSION=${APP_VERSION}

WORKDIR /app

RUN apk add --no-cache wget ca-certificates

COPY --from=deps /app/node_modules /app/node_modules

# Preserves the same relative depth as the real source tree
# (packages/agent/version.ts lives two directories under the repo root, and
# imports "../../package.json" from there to read the app's real version at
# build time, no separate agent/package.json to duplicate/drift it, see
# that file's own comment) rather than flattening to /app/agent : real,
# CI-observed finding, a flattened COPY to /app/agent (one level, not two)
# left version.ts's relative import resolving to a path that doesn't exist
# in the image, failing this whole build stage.
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

# packages/docs/ is a standalone static SvelteKit site sharing this same root
# package.json/bun.lock rather than its own (see its own README), so the
# already-installed `deps` node_modules cover it too, no separate `bun
# install` needed here. It reads docs/*.md and the repo root's own
# openapi.json straight from the checkout at build time
# (src/lib/docs-content.ts, and the openapi.json copy below), so the full
# checkout has to be present, not just packages/docs/ on its own.
COPY . .

COPY --from=deps /app/node_modules /app/node_modules

# Real, tested finding: this repo's pinned rolldown-vite (see the root
# package.json's own "vite"/"rolldown" versions, both pre-1.0/beta) has a
# built-in TS-transform plugin that, for files under packages/docs/, resolves
# tsconfig.json's "extends" chain against the *repo root* (/app in this
# image) instead of packages/docs/ itself, regardless of what
# packages/docs/tsconfig.json actually says (confirmed: changing that file's
# own "extends" value had no effect on the error, which kept citing the
# *root* tsconfig.json's own extends target). Since this image never runs
# the main app's own `svelte-kit sync` (no reason to, only packages/docs/ is
# being built here), /app/.svelte-kit/tsconfig.json doesn't exist, and the
# build fails outright with "Tsconfig not found /app/.svelte-kit/tsconfig.json"
# before ever reaching packages/docs/'s own config. A minimal stub at that
# exact path satisfies the (buggy) resolver without needing the real generated
# file; it doesn't affect the actual output, packages/docs/'s own tsconfig.json
# (via `svelte-kit sync`, run next) still drives real type-aware tooling
# (`bun run check:docs`). Revisit if a future rolldown-vite upgrade fixes this
# upstream.
RUN mkdir -p .svelte-kit && echo '{"compilerOptions":{}}' > .svelte-kit/tsconfig.json

# The root openapi.json is checked into git (regenerated via `bun run gen`,
# see CLAUDE.md's OpenAPI section) and already present from the `COPY . .`
# above ; copied into packages/docs/static/ so its own Swagger UI page
# (src/routes/docs/api/+page.svelte) can serve it as a plain static asset,
# same "cp, tolerate it being missing" shape as package.json's own
# `dev:docs`/`build:docs` scripts.
RUN cp openapi.json packages/docs/static/openapi.json

RUN cd packages/docs && ../../node_modules/.bin/svelte-kit sync && ../../node_modules/.bin/vite build

FROM nginx:1.27-alpine AS docs

# A fully static, fully prerendered site (see packages/docs/svelte.config.js),
# nginx just serves the files vite build already wrote, no runtime of its own
# needed the way the app/agent images have.
COPY --from=docs-builder /app/packages/docs/build /usr/share/nginx/html

# Real, tested finding: adapter-static (kit.paths.trailingSlash default
# "never") writes each route as a flat "<route>.html" file
# (docs/getting-started.html), not "<route>/index.html", so nginx's own
# default config 404'd every page but "/" (its default only auto-appends
# "index.html" for a directory request). packages/docs/nginx.conf's
# `try_files $uri $uri.html $uri/ =404;` fixes that.
COPY packages/docs/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1
