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

- **[Services](docs/services.md)**: deploy from a Docker image _or_
  [build from a git repo's Dockerfile](docs/services.md#deploy-source-image-or-git-repo)
  (any git-clone-able HTTPS URL, including a self-hosted Gitea); env vars,
  CPU/memory limits, restart policy, private registry auth
- **[Live deploy progress](docs/services.md#deploying)**:
  pull/build/create/start streamed to the UI in real time, resumes correctly if
  you reload mid-deploy
- **[Revisions & rollback](docs/services.md#revisions-and-rollback)**: every
  attempt recorded with status, image digest, and its full log; redeploy any
  earlier revision's exact image, with opt-in auto-rollback when a new one comes
  up unhealthy
- **[Image scanning](docs/services.md#image-scanning)**: every deploy scanned
  with Trivy before it starts, with an admin policy that blocks deploys on
  findings at or above a chosen severity (optionally fixable ones only), and
  scan results readable from the dashboard, REST API and CLI
- **[Required status checks](docs/services.md#required-status-checks)**: a
  git-based service can wait for its CI checks to pass before it builds
- **[Search, filters, pagination & bulk actions](docs/services.md#the-services-list)**:
  every list page (services, stacks, templates, storage, and more) gets
  server-side search/filters, a list/card view toggle, and paging once you have
  more than a screenful; multi-select Start/Stop/Restart/Delete on the services
  list, with a typed confirmation before anything destructive runs
- **[Stacks](docs/stacks-and-templates.md#stacks)**: group services under one
  Docker network so they reach each other by slug (`http://api:8080`),
  independent of the shared Traefik network
- **[Templates](docs/stacks-and-templates.md#templates)**: a built-in catalog of
  ~70 common self-hosted apps (Jellyfin, the *arr stack, Pi-hole, Vaultwarden,
  Grafana, Uptime Kuma, PostgreSQL, Redis, n8n and more) with real app logos,
  one-click **Quick Deploy**, companion containers that come along with the
  primary (WordPress pulls MySQL), plus save any service's config as your own
  reusable template
- **[Storage volumes](docs/storage-and-backups.md#storage-volumes)**: define
  bind-mount paths or Docker-managed volumes once, mount into one or more
  services
- **[Migrate from Dokploy or Coolify](docs/services.md#migrating-from-dokploy-or-coolify)**:
  read another instance's apps, compose stacks and databases and recreate them
  here
- **[Compose import](docs/services.md#importing-a-compose-file)**: paste a
  `docker-compose.yaml` and turn its services, volumes and dependency order into
  Homerun rows, with an up-front preview of everything that doesn't map across
- **[Smart service links](docs/services.md#env-vars)**: point a new service at
  an existing Postgres, MySQL, Redis, Mongo or RabbitMQ and get the connection
  URL (or JDBC URL, or one variable per value) filled in for you, with names you
  can rename
- **[Live log streaming](docs/services.md#logs) &
  [a web terminal](docs/services.md#terminal)**: tail stdout/stderr or open an
  interactive shell into a running container, all from the browser
- **[Uptime & resource history](docs/services.md#observability) and
  [status pages](docs/operations.md#status-pages)**: every service probed from
  the Docker network and from its public hostname, CPU/memory/network history
  per service and for the host, and public or private status pages built from
  those probes
- **[Custom domains & SSL](docs/services.md#custom-domains--ssl)**: a second
  hostname per service, plus bring-your-own cert/key for domains outside
  Traefik's automatic ACME coverage
- **[Build servers](docs/remote-hosts-and-agent.md)**: build a git-based
  service's image on another Docker daemon (`tcp://`/`ssh://`, or the
  lightweight [Homerun Agent](packages/agent/README.md)) instead of this host
- **[Swarm mode](docs/services.md#swarm-mode)**: opt-in Docker Swarm deploys for
  real replica scaling and load balancing across one service, instead of the
  default one-container model
- **[Docker Cleanup](docs/operations.md#docker-cleanup)**: admin-only host-wide
  `docker system df`/prune from the dashboard, unused
  images/containers/volumes/networks/build cache and the scan image mirror, with
  a preview before you prune
- **[DNS automation](docs/services.md#dns-automation)**: optional Cloudflare or
  self-hosted Pangolin integration auto-manages a deployed service's DNS record
  for you
- **[Notifications](docs/operations.md#notifications)**: a per-user in-app feed
  of deploy/service lifecycle events, plus outbound notification channels
  (Discord, generic webhook, email) you can subscribe to build, update, deploy
  and uptime events
- **[Scheduled redeploys](docs/services.md#scheduled-redeploy),
  [cron jobs](docs/services.md#cron-jobs) &
  [S3 backups](docs/storage-and-backups.md)**: cron-style auto-redeploy per
  service, standalone cron jobs (a throwaway container, or an admin-only host
  command) with their own run history, and cron-style volume backups, bind
  mounts and Docker-managed volumes alike, to any S3-compatible endpoint, with
  restore from the dashboard
- **[REST API, OpenAPI docs, and a CLI](docs/api-and-cli.md)**: everything above
  is also a typed JSON API (`/api/v1`), authenticated by session or API key,
  with a live Swagger UI and a proper [`homerun` CLI](packages/cli/README.md)
  built against the generated OpenAPI types
- **[Users, roles & invites](docs/users-and-access.md)**: admin/developer roles,
  email or direct-create invites,
  [OAuth/OIDC sign-in](docs/users-and-access.md#oauth--oidc-login) with
  one-click presets for Pocket ID, Keycloak, Authelia, Authentik, Logto, Zitadel
  and Kanidm, and
  [passkeys and two-factor authentication](docs/users-and-access.md#two-factor-authentication-and-passkeys),
  which an admin can require for every account
- **[Sign in with Homerun](docs/users-and-access.md#sign-in-with-homerun)**:
  Homerun is an OpenID Connect provider too, so the apps you host (Grafana,
  Gitea, Outline, Immich…) can log in with your Homerun accounts, passkeys and
  2FA rules, with no separate Pocket ID or Authentik to run
- **[Git provider accounts](docs/users-and-access.md#git-provider-accounts)**:
  connect GitHub, GitLab, self-hosted Gitea or Bitbucket, pick a repo and branch
  instead of pasting URLs, and
  [deploy on every push](docs/services.md#deploy-on-push) through a webhook
  Homerun registers for you
- **[Operations](docs/operations.md)**: live logs for Traefik and the rest of
  the instance's own stack, Traefik restart/update from the dashboard, a
  [job-queue and scheduling overview](docs/operations.md#the-scheduling-page),
  [setup diagnostics](docs/operations.md#setup-diagnostics) that deep-link
  straight to the setting that's wrong, a
  [`⌘K` search](docs/operations.md#search) across pages and everything you own,
  and [one-click self-update](docs/operations.md#upgrading-homerun-itself) to
  the latest release
- **[Per-service auth gate](docs/users-and-access.md#per-app-login-wall) &
  account isolation**: optionally require a Homerun login to reach a deployed
  service; every container is labeled `homerun.managed=true` so this app never
  touches anything it didn't create
- **[Appearance](docs/users-and-access.md#appearance)**: per-account
  light/dark/system theme, sidebar color intensity, and a custom accent color,
  from your profile page

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

Three standalone Bun/TypeScript tools live under `packages/` alongside the main
app (sharing the root `package.json`/`bun install`, each compiling to its own
binary or build output):

- [`packages/agent/`](packages/agent/README.md): a small token-authenticated
  HTTP server that lets a second machine build images for this one, without
  exposing its Docker daemon
- [`packages/installer/`](packages/installer/README.md): the one-liner installer
  used above (Docker + rootless setup + the agent or full stack)
- [`packages/cli/`](packages/cli/README.md): a typed CLI
  (`homerun services deploy <id>`, etc.) against the REST API
