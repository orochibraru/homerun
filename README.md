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

<!-- Regenerate with `bun run screenshots`; do not edit by hand. -->

[![Homerun's dashboard](docs/images/hero.png)](docs/showcase.md)

**[See the full showcase →](docs/showcase.md)** — every screen, light and dark,
generated from a real instance.

## Why Homerun

Dokploy, Coolify, and friends are great, but there are stuff I can't get around:

- Coolify has many bugs and a lot of tech debt
- Dokploy has started paywalling features that homelab enthusiasts could use at
  the benefit of enterprise.

## Features

### Deploying

- **[Image or git repo](docs/deploy-source-and-builds.md#deploy-source-image-or-git-repo)**:
  deploy any Docker image (private registry auth included), or clone a repo by
  branch, tag or pinned commit and build it on the host, with no registry in
  between
- **[Six build methods](docs/deploy-source-and-builds.md#build-methods)**: a
  `Dockerfile` or a Docker Bake target built with BuildKit (cache mounts,
  multi-stage, `# syntax=`), or no Dockerfile at all with Nixpacks, Railpack,
  Heroku or Paketo buildpacks, builder binaries checksum-verified
- **[Deploy on push](docs/deploy-on-push.md)**: Homerun registers the webhook on
  your repo for you, and falls back to polling the branch when the git provider
  can't reach your dashboard (LAN, VPN)
- **[Pull request previews](docs/pull-request-previews.md)**: every pull request
  gets its own `<slug>-pr-<n>` service, redeployed on each push and deleted on
  merge or close, with forks never previewed
- **[Required status checks](docs/status-checks.md)**: a git service waits for
  the CI checks you pick to pass, then builds exactly the commit they passed on
- **[Build servers & build cache](docs/deploy-source-and-builds.md#build-servers-and-build-cache)**:
  compile on another Docker daemon (`tcp://`, `ssh://` or the lightweight
  [Homerun Agent](docs/remote-hosts-and-agent.md#homerun-agent)), and share
  BuildKit layer cache through a registry
- **[Live deploy progress](docs/deploying.md)**: pull/build/create/start
  streamed to the UI in real time, and it resumes if you reload mid-deploy or
  the deploy started somewhere else
- **[Zero-downtime, health-gated redeploys](docs/deploying.md)**: the new
  container starts next to the old one and only gets traffic once it's ready
  (its healthcheck, the image's, or a port check Homerun adds itself); a new
  copy that never comes up is removed and the old one keeps serving
- **[Revisions & rollback](docs/revisions-and-rollback.md)**: every deploy
  recorded with its image digest, commit and full log; redeploy any earlier
  revision's exact image, with opt-in auto-rollback when a new one turns
  unhealthy
- **[Image scanning](docs/image-scanning.md)**: every deploy scanned with Trivy
  through a local registry mirror before it starts, so the container runs
  exactly what was scanned, with an admin policy that blocks deploys at or above
  a chosen severity (optionally fixable findings only)
- **[Compose import](docs/compose-import.md)**: paste a `docker-compose.yaml`
  and get its services, volumes, runtime options and dependency order as Homerun
  services, with a preview of anything that doesn't map across
- **[Migrate from Dokploy or Coolify](docs/migrating-from-dokploy-or-coolify.md)**:
  read another instance's apps, compose stacks and databases (read-only on their
  side) and recreate them here, builders and start commands included

### Running services

- **[Swarm mode](docs/swarm-mode.md)**: the installer's default, every service
  is a Docker Swarm service with replica scaling and load balancing, and more
  machines join as workers with one command; standalone (one container per
  service) stays available
- **[Env vars & env files](docs/env-vars.md)**: key/value rows plus `.env` files
  read off the host at each deploy
- **[Smart service links](docs/env-vars.md)**: point a service at an existing
  Postgres, MySQL, Redis, Mongo, RabbitMQ or HTTP service and get the connection
  URL, JDBC URL or one variable per value filled in for you
- **[Runtime options](docs/runtime-and-compute.md#runtime)**: entrypoint,
  command, custom labels, and (admin-only) added capabilities, device mappings
  and privileged mode
- **[Compute & settings](docs/services.md#settings)**: CPU/memory limits,
  replicas, restart and pull policies, a healthcheck command, and scanning and
  auto-rollback per service
- **[Live logs](docs/observability.md#logs) &
  [a web terminal](docs/observability.md#terminal)**: tail stdout/stderr or open
  an interactive shell into a running container from the browser
- **[The services list](docs/services.md#the-services-list)**: server-side
  search, filters and paging on every list page, a list/card toggle, and bulk
  Start/Stop/Restart/Delete with a typed confirmation before anything
  destructive

### Stacks & templates

- **[Stacks](docs/stacks.md)**: group services on their own private Docker
  network so they reach each other by slug (`http://api:8080`), with prefixed
  subdomains and one-step delete of the whole stack
- **[~70 built-in templates](docs/templates.md)**: Jellyfin, the *arr stack,
  Pi-hole, Vaultwarden, Grafana, Uptime Kuma, PostgreSQL, Redis, n8n and more,
  with bundled app logos, one-click **Quick Deploy**, and a details page that
  pulls in the project's GitHub README, stars and latest release
- **[Linked containers](docs/templates.md#linked-containers)**: companions
  deploy with the primary (WordPress brings MySQL), and env vars like
  `{{db.POSTGRES_PASSWORD}}` wire them together without retyping
- **Custom templates**: save any service's config as your own template, or build
  one from scratch

### Networking & domains

- **Automatic routing & TLS**: Traefik routes every service to
  `<slug>.<baseDomain>` with a certificate, with no host ports published
- **[Custom domains & SSL](docs/networking.md#custom-domains--ssl)**: a second
  hostname per service, plus bring-your-own cert/key for domains outside
  Traefik's automatic ACME coverage
- **[Host networking](docs/networking.md)**: for apps that need the host's
  network directly (mDNS/SSDP discovery)
- **[DNS automation](docs/dns-automation.md)**: Cloudflare CNAMEs or Pangolin
  resources created and removed as services come and go, and Homerun can run the
  Pangolin Newt tunnel client for you, set up straight from onboarding
- **[Per-app login wall](docs/login-wall.md)**: put any deployed service behind
  a Homerun login (passkeys and 2FA included) through Traefik forwardAuth

### Storage & backups

- **[Storage volumes](docs/storage-volumes.md)**: bind mounts or Docker-managed
  volumes defined once, mounted into one or more services, read-write or
  read-only
- **[S3 backups](docs/backups.md#s3-compatible-backups)**: scheduled or
  on-demand backups of both volume kinds to any S3-compatible endpoint, with
  optional service stop or a pre-backup command (`pg_dump`, `mysqldump`) for
  consistent database copies
- **[Restore from the dashboard](docs/backups.md#restoring-a-backup)**: browse a
  volume's backups in the bucket and restore one, optionally wiping the volume
  first, with a searchable history of every run

### Observability & notifications

- **[Uptime probes](docs/observability.md#uptime)**: every service probed every
  minute from the Docker network and from its public hostname, with failure
  reasons and fix hints
- **[Status pages](docs/status-pages.md)**: private or public uptime pages for
  every service, one stack, or services you pick
- **[Resource history](docs/dashboard.md)**: live and historical CPU, memory,
  disk, network and NVIDIA GPU usage for the host and each service, kept for a
  year, plus top consumers per instance and per stack
- **[Errors in context](docs/observability.md#errors)**: failed deploys and the
  warnings Homerun logged about a service, on that service's page, with crash
  and "container is gone" banners
- **[Notifications](docs/notifications.md)**: an in-app bell, plus Discord,
  Slack, Telegram, webhook and email channels subscribed to build, deploy,
  update, rollback, scan and up/down events, retried when delivery fails

### Scheduling

- **[Scheduled redeploys](docs/scheduling.md#scheduled-redeploy)**: cron-style
  auto-redeploy per service to pick up new images
- **[Cron jobs](docs/scheduling.md#cron-jobs)**: a throwaway container, or an
  admin-only command on the host itself, on a schedule, with exit codes and
  output kept per run
- **[The Scheduling page](docs/scheduling.md#the-scheduling-page)**: every cron
  redeploy, job and backup schedule, plus the live job queue, on one page

### Users & security

- **[Roles & invites](docs/users-and-roles.md)**: admin, developer and read-only
  roles, email or direct-create invites, and a resource pool the whole team
  shares
- **[OAuth/OIDC sign-in](docs/authentication-providers.md#oauth--oidc-login)**:
  one-click presets for Pocket ID, Keycloak, Authelia, Authentik, Logto, Zitadel
  and Kanidm
- **[Passkeys & two-factor](docs/two-factor-and-passkeys.md)**: which an admin
  can require for every account
- **[Sign in with Homerun](docs/sign-in-with-homerun.md)**: Homerun is an OpenID
  Connect provider too, so the apps you host (Grafana, Gitea, Outline, Immich…)
  log in with your Homerun accounts, passkeys and 2FA rules
- **[Git provider accounts](docs/git-providers.md)**: connect GitHub, GitLab,
  self-hosted Gitea or Bitbucket and pick a repo and branch instead of pasting
  URLs
- **[API keys](docs/your-profile.md#api-keys)**: full-access or read-only,
  created by hand or through `homerun login`
- **Hands off everything else**: every container is labeled
  `homerun.managed=true`, and Homerun never touches anything it didn't create
  (Docker Cleanup being the one deliberate exception)

### API & CLI

- **[REST API & OpenAPI](docs/api-and-cli.md)**: everything in the dashboard is
  also a typed JSON API (`/api/v1`), authenticated by session or API key, with a
  live Swagger UI
- **[The `homerun` CLI](packages/cli/README.md)**: a small (~6MB) standalone Go
  binary, logs in through a device-code flow and updates itself

### Install & operations

- **[One-line installer](docs/getting-started.md#option-a-the-one-liner-fresh-linux-server)**:
  Docker, a swarm manager, Traefik, Postgres and Homerun on a fresh Linux box in
  one command, or rootless Docker if you'd rather, and
  [a rootless-to-rootful migration](docs/getting-started.md#moving-a-rootless-install-to-rootful--swarm)
  for older installs
- **[First-run wizard](docs/configuration.md#the-first-run-wizard)**: configure
  base domain, email, sign-in and DNS in the dashboard, with no config file to
  maintain, and an
  [optional `homerun.yaml`](docs/configuration.md#the-optional-yaml-file) if you
  want config as code
- **[One-click self-update](docs/upgrading.md)**: to the latest release,
  straight from the sidebar
- **[Setup diagnostics](docs/dashboard.md#setup-diagnostics)**: a banner that
  deep-links to the exact setting that's wrong
- **[System logs](docs/system-logs.md)**: live logs of Traefik, Postgres and
  Homerun itself, with Traefik restart and update buttons
- **[Docker Cleanup](docs/docker-cleanup.md)**: admin-only
  `docker system df`/prune from the dashboard with a preview before anything
  goes, plus automatic garbage collection of the scan mirror
- **[`⌘K` search](docs/dashboard.md#search)**: jump to any page, or to anything
  on the instance, from anywhere
- **[Appearance](docs/your-profile.md#appearance)**: light/dark/system theme,
  sidebar intensity and a custom accent color per account

## Configuration

You configure Homerun from its own dashboard. The installer sets up everything
the container needs to boot and then hands you a first-run wizard; after that,
base domain, Docker, Traefik, email, sign-in methods, DNS automation and
orchestration mode are all settings pages. There's no config file to maintain,
just `AUTH_SECRET` and `ORIGIN` if you're running `docker compose` by hand
instead of using the installer — an optional `homerun.yaml` file mirrors every
setting for config-as-code setups, with a dashboard change always winning over
the file. See [`docs/configuration.md`](docs/configuration.md).

## Documentation

[`docs/`](docs/README.md) in this repo is the source of truth, plain Markdown,
readable straight from the file browser. Start with
[Getting started](docs/getting-started.md). The
[website](https://homerun.orochibraru.com) renders the same files.

## Sub-projects

Three standalone tools live under `packages/` alongside the main app, each
compiling to its own binary. `packages/agent/` and `packages/installer/` are
Bun/TypeScript, sharing the root `package.json`/`bun install`; `packages/cli/`
is a separate Go module instead:

- [`packages/agent/`](packages/agent/README.md): a small token-authenticated
  HTTP server that lets a second machine build images for this one, without
  exposing its Docker daemon
- [`packages/installer/`](packages/installer/README.md): the one-liner installer
  used above (Docker as a swarm manager, or rootless, plus the agent or full
  stack, and `--migrate-to-rootful` for older rootless installs)
- [`packages/cli/`](packages/cli/README.md): a CLI
  (`homerun services deploy <id>`, etc.) against the REST API
