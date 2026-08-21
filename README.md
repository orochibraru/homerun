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

## Quick start

Two ways to run it, both entirely from prebuilt release binaries and Docker
images, no Bun, no `git`, no source checkout needed for either.

**Fresh Linux server, one command.** Installs Docker (rootless), the
`homerun-network`, and brings up Traefik + Postgres + the app itself, all pulled
from published images:

```sh
curl -fsSL https://git.ombrage.space/orochibraru/homerun/raw/branch/main/installer/bootstrap.sh \
  | sudo bash -s -- --mode=full
```

Prefer to see every command before it runs? Add `--dry-run`. Full flag reference
and what the installer actually does:
[`installer/README.md`](installer/README.md).

**Already running Docker your own way?** Grab
[`compose.prod.yaml`](compose.prod.yaml) instead, same three services, no
rootless setup, no installer:

```sh
curl -fsSLO https://git.ombrage.space/orochibraru/homerun/raw/branch/main/compose.prod.yaml
curl -fsSLO https://git.ombrage.space/orochibraru/homerun/raw/branch/main/.env.example
mv .env.example .env && $EDITOR .env   # set AUTH_SECRET at minimum
docker network create homerun-network
docker compose -f compose.prod.yaml up -d
```

Open `http://localhost:3000`, create the first account (it becomes admin
automatically), and the onboarding wizard walks through base domain / Docker /
Traefik / email setup. Full walkthrough, including every env var:
[`docs/getting-started.md`](docs/getting-started.md). Want to run this from
source to develop on it? [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Why Homerun

Dokploy, Coolify, and friends are great, but there are stuff I can't get around:

- Coolify has many bugs and a lot of tech debt
- Dokploy has started paywalling features that homelab enthusiasts could use at
  the benefit of fucking enterprise as always

## Features

- **Services**: deploy from a Docker image _or_ build from a git repo's
  Dockerfile (any git-clone-able HTTPS URL, including a self-hosted Gitea); env
  vars, CPU/memory limits, restart policy, private registry auth
- **Live deploy progress**: pull/build/create/start streamed to the UI in real
  time, resumes correctly if you reload mid-deploy
- **Deployment history**: every attempt recorded with status, image digest, and
  its full log
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
  or the lightweight [Homerun Agent](agent/README.md)) instead of the local
  socket
- **Autoscale-by-migration**: when the local host crosses a CPU/memory
  threshold, automatically move one opted-in service to a designated overflow
  host
- **Scheduled redeploys & S3 backups**: cron-style auto-redeploy per service,
  cron-style bind-mount volume backups to any S3-compatible endpoint
- **REST API, OpenAPI docs, and a CLI**: everything above is also a typed JSON
  API (`/api/v1`), with a live Swagger UI and a proper
  [`homerun` CLI](cli/README.md) built against the generated OpenAPI types
- **Users, roles & invites**: admin/developer roles, email or direct-create
  invites, optional OAuth/OIDC login
- **Per-service auth gate & account isolation**: optionally require a Homerun
  login to reach a deployed service; every container is labeled
  `homerun.managed=true` so this app never touches anything it didn't create

See [`docs/`](docs/) for the full breakdown of every feature above, or
[`CLAUDE.md`](CLAUDE.md) for architecture-level detail if you're contributing.

## Documentation

Start at [`docs/README.md`](docs/README.md) for guides on installing,
configuring, deploying services, remote hosts, backups, the API/CLI, and known
limitations.

## Sub-projects

Three standalone Bun/TypeScript tools ship alongside the main app, each its own
`package.json`/binary:

- [`agent/`](agent/README.md): a small token-authenticated HTTP server for
  driving a _remote_ host's Docker daemon
- [`installer/`](installer/README.md): the one-liner installer used above
  (Docker + rootless setup + the agent or full stack)
- [`cli/`](cli/README.md): a typed CLI (`homerun services deploy <id>`, etc.)
  against the REST API
