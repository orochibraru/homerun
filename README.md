# Homerun

A self-hosted, single-user PaaS for deploying Docker containers with a click-config form — a minimal Dokploy/Cloud-Run alternative. Point at an image, fill in env vars/port/resources, deploy — Traefik auto-routes it to `<slug>.<baseDomain>` with TLS.

Single host, local Docker socket only. No multi-node orchestration. No git/Dockerfile build pipeline — bring-your-own-image.

## Stack

SvelteKit 2 (Svelte 5 runes) + Bun runtime, better-auth, Drizzle ORM over `bun:sqlite`, Tailwind v4 + shadcn-svelte, dockerode.

## Features

- **Services** — deploy any image, manage env vars, resource limits, restart policy, private registry auth
- **Live deploy progress** — pull/create/start steps streamed to the UI while deploying, resumes correctly on page reload mid-deploy
- **Deployment history** — every deploy recorded with status, image digest, and its full progress log
- **Projects** — group services together; each project gets its own Docker network so member services can reach each other by slug (`http://<slug>:<port>`), in addition to the shared Traefik network
- **Templates** — one-click deploy for common services (Redis, Postgres, MySQL, MongoDB, Adminer, Uptime Kuma, n8n, Vaultwarden), plus save any service's config as a reusable custom template
- **Storage volumes** — define local Docker-managed volumes or host bind-mount paths once, mount them into one or more services from each service's Volumes tab
- **Live log streaming** — tail a running container's stdout/stderr from the browser
- **Account/service isolation** — every container is labeled `localrun.managed=true`; the app never touches a container it didn't create

## Commands

```
bun run dev              # vite dev
bun run build            # vite build
bun run start            # bun run ./build/index.js
bun run db:generate      # drizzle-kit generate — regenerate migrations from schema.ts
docker compose up -d     # bootstraps Traefik — required for subdomain routing
```

See `CLAUDE.md` for architecture details and conventions for contributors (human or AI).
