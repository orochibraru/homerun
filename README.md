# Homerun

**A self-hosted, single-user PaaS for deploying Docker containers with a
click-config form**: a minimal Dokploy / Cloud Run alternative for your own
hardware.

Point at an image (or a git repo), fill in env vars / port / resources, hit
deploy: Traefik routes it to `<slug>.yourdomain.com` with TLS, automatically.
Single host, local Docker socket, no Kubernetes, no multi-node orchestration to
babysit.

> **Status:** Actively developed, running on real hardware, but still finding
> its shape: see [`docs/faq-and-limitations.md`](docs/faq-and-limitations.md)
> for what's solid and what isn't yet.

## Why Homerun

Dokploy, Coolify, and friends are great, but there are stuff I can't get around:

- Coolify has many bugs and a lot of tech debt
- Dokploy has started paywalling features that homelab enthusiasts could use at
  the benefit of enterprise.

## Features

- **Services**: deploy from a Docker image _or_ build from a git repo's
  Dockerfile (any git-clone-able HTTPS URL, including a self-hosted Gitea); env
  vars, CPU/memory limits, restart policy, private registry auth
- **Live deploy progress**: pull/build/create/start streamed to the UI in real
  time, resumes correctly if you reload mid-deploy
- **Deployment history**: every attempt recorded with status, image digest, and
  its full log
- **Search, filters, pagination & bulk actions**: every list page (services,
  projects, templates, storage, and more) gets server-side search/filters, a
  list/card view toggle, and paging once you have more than a screenful;
  multi-select Start/Stop/Restart/Delete on the services list, with a typed
  confirmation before anything destructive runs
- **Projects**: group services under one Docker network so they reach each other
  by slug (`http://api:8080`), independent of the shared Traefik network
- **Templates**: one-click deploys for common services (Redis, Postgres, MySQL,
  MongoDB, Adminer, Uptime Kuma, n8n, Vaultwarden), plus save any service's
  config as your own reusable template
- **Storage volumes**: define bind-mount paths or Docker-managed volumes once,
  mount into one or more services
- **Live log streaming & a web terminal**: tail stdout/stderr or open an
  interactive shell into a running container, all from the browser
- **Custom domains & SSL**: a second hostname per service, plus bring-your-own
  cert/key for domains outside Traefik's automatic ACME coverage
- **Remote hosts**: point a service at another Docker daemon (`tcp://`/`ssh://`,
  or the lightweight [Homerun Agent](packages/agent/README.md)) instead of the
  local socket
- **Autoscale-by-migration**: when the local host crosses a CPU/memory
  threshold, automatically move one opted-in service to a designated overflow
  host
- **Swarm mode**: opt-in Docker Swarm deploys for real replica scaling and load
  balancing across one service, instead of the default one-container model
- **Docker Cleanup**: admin-only host-wide `docker system df`/prune from the
  dashboard, unused images/containers/volumes/networks/build cache, with a
  preview before you prune
- **DNS automation**: optional Cloudflare or self-hosted Pangolin integration
  auto-manages a deployed service's DNS record for you
- **In-app notifications**: a per-user feed of deploy/service lifecycle events
- **Scheduled redeploys & S3 backups**: cron-style auto-redeploy per service,
  cron-style bind-mount volume backups to any S3-compatible endpoint
- **REST API, OpenAPI docs, and a CLI**: everything above is also a typed JSON
  API (`/api/v1`), with a live Swagger UI and a proper
  [`homerun` CLI](packages/cli/README.md) built against the generated OpenAPI
  types
- **Users, roles & invites**: admin/developer roles, email or direct-create
  invites, optional OAuth/OIDC login
- **Per-service auth gate & account isolation**: optionally require a Homerun
  login to reach a deployed service; every container is labeled
  `homerun.managed=true` so this app never touches anything it didn't create
- **Appearance**: per-account light/dark/system theme, sidebar color intensity,
  and a custom accent color, from your profile page

## Documentation

See [the website](https://homerun.orochibraru.com)

## Sub-projects

Four standalone Bun/TypeScript tools live under `packages/` alongside the main
app (sharing the root `package.json`/`bun install`, each compiling to its own
binary or build output):

- [`packages/agent/`](packages/agent/README.md): a small token-authenticated
  HTTP server for driving a _remote_ host's Docker daemon
- [`packages/installer/`](packages/installer/README.md): the one-liner installer
  used above (Docker + rootless setup + the agent or full stack)
- [`packages/cli/`](packages/cli/README.md): a typed CLI
  (`homerun services deploy <id>`, etc.) against the REST API
- [`packages/docs/`](packages/docs/README.md): the static docs site rendering
  this repo's `docs/*.md` guides (what's deployed at
  [the website](https://homerun.orochibraru.com))
