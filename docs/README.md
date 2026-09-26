# Homerun docs

Homerun is a self-hosted, single-user PaaS: point at a Docker image or a git
repo, fill in a form, deploy: Traefik routes it to `<slug>.yourdomain.com` with
TLS. Single host, local Docker socket, no multi-node orchestration.

This directory is plain Markdown, the source of truth: read it straight from the
repo, or on your GitHub remote's file browser. The
[website](https://homerun.orochibraru.com) renders these same files from its own
separate repository; it's a companion renderer, not a second copy to keep in
sync by hand.

**[Showcase](showcase.md)**: what it looks like, every screen, light and dark.

## Getting started

- **[Getting started](getting-started.md)**: install (the one-liner or Docker
  Compose), first boot, the onboarding wizard, and deploying your first service.
- **[Configuration](configuration.md)**: what you set in the dashboard (almost
  everything), the three values the container needs before it can start, and the
  optional YAML file for config-as-code setups.
- **[FAQ & limitations](faq-and-limitations.md)**: what's genuinely finished,
  what's a known gap, and what's on the roadmap.

## Services

- **[Services](services.md)**: creating a service, the services list, bulk
  actions, and the Settings tab (pull policy, healthcheck, save as template).
- **[Deploy source and build methods](deploy-source-and-builds.md)**: image or
  git repo, the six build methods, build servers and the build cache registry.
- **[Connecting a git provider](git-providers.md)**: GitHub, GitLab, Gitea or
  Bitbucket OAuth apps, and browsing your repos from the Source tab.
- **[Deploy on push](deploy-on-push.md)**: webhooks registered for you, manual
  webhooks, and polling the branch when the provider can't reach you.
- **[Deploying from CI](ci-cd.md)**: the GitHub Action, the CLI image for GitLab
  and other CIs, and the raw API call, deploying the tag your pipeline just
  pushed.
- **[Pull request previews](pull-request-previews.md)**: a service per pull
  request, and why forks are never previewed.
- **[Required status checks](status-checks.md)**: holding a build until CI
  passes on the exact commit.
- **[Importing a compose file](compose-import.md)**: what maps across from a
  `docker-compose.yaml`, and what comes back as a warning.
- **[Migrating from Dokploy or Coolify](migrating-from-dokploy-or-coolify.md)**:
  reading another instance and recreating its apps, stacks and databases here.
- **[Deploying](deploying.md)**: the live progress panel, health-gated
  redeploys, readiness checks and retried requests.
- **[Revisions and rollback](revisions-and-rollback.md)**: every deploy as a
  revision, rolling back, retained images and auto-rollback.
- **[Image scanning](image-scanning.md)**: Trivy scans through the registry
  mirror, the Security tab, and blocking deploys on findings.
- **[Env vars](env-vars.md)**: key/value rows, linking a service to fill in
  connection details, and env files on the host.
- **[Networking](networking.md)**: container port, network mode,
  DNS-resolvability, extra domains and your own SSL certificates.
- **[DNS automation](dns-automation.md)**: keeping Cloudflare records or
  Pangolin resources in sync with your services.
- **[Runtime and compute](runtime-and-compute.md)**: entrypoint, command,
  labels, capabilities, devices, privileged mode, and CPU/memory limits.
- **[Swarm mode](swarm-mode.md)**: replicas, what swarm mode changes, and adding
  a node.
- **[Observability](observability.md)**: uptime probes, live logs, failed
  deploys and errors, and the web terminal.
- **[Scheduling and the job queue](scheduling.md)**: scheduled redeploys, cron
  jobs, the Scheduling page, and the background job queue.

## Stacks, templates and storage

- **[Stacks](stacks.md)**: grouping services on a shared private network,
  nesting stacks, and the dependency tree/diagram.
- **[Templates](templates.md)**: the built-in app catalog, quick deploys, host
  access, linked companion containers, and saving your own.
- **[Storage volumes](storage-volumes.md)**: bind-mount and Docker-managed
  volumes, and mounting them into services.
- **[S3 backups](backups.md)**: reusable S3 destinations, scheduled backups of
  either volume kind, the backup history, and restoring.
- **[Build servers & the Homerun Agent](remote-hosts-and-agent.md)**: building
  images on a second machine, the standalone agent and installer.

## Users and access

- **[Users and roles](users-and-roles.md)**: admin, developer and read-only,
  creating and inviting accounts, and onboarding.
- **[Authentication providers](authentication-providers.md)**: OAuth/OIDC
  sign-in, preferred methods, sign-in requirements, and linking a provider to an
  existing account.
- **[Your profile](your-profile.md)**: personal information, sessions, API keys,
  appearance, and git provider accounts.
- **[Two-factor authentication and passkeys](two-factor-and-passkeys.md)**:
  authenticator codes, backup codes, and passkeys.
- **[Per-app login wall](login-wall.md)**: requiring a sign-in before anyone
  reaches a service, and who's allowed through.
- **[Sign in with Homerun](sign-in-with-homerun.md)**: Homerun as an OIDC
  provider for the apps you host, and registering the client Claude needs to use
  the MCP server.

## Operations and maintenance

- **[The dashboard](dashboard.md)**: service counts, host resources and history,
  `⌘K` search, and setup diagnostics.
- **[System Logs](system-logs.md)**: live logs of your instance's stack and
  Traefik, and restarting or updating Traefik.
- **[Docker Cleanup](docker-cleanup.md)**: previewing and pruning what Docker
  can reclaim, and the image mirror cleanup.
- **[Registry](registry.md)**: turning the image mirror into a real private
  registry, push/pull tokens, and publishing it at a hostname.
- **[Notifications](notifications.md)**: the bell, and sending events to
  Discord, Slack, Telegram, a webhook or email.
- **[Status pages](status-pages.md)**: private or public uptime pages.
- **[Upgrading Homerun](upgrading.md)**: the one-click update, and upgrading by
  hand.
- **[API & CLI](api-and-cli.md)**: the REST API, the live Swagger UI, the
  `homerun` CLI, and the MCP server for AI agents (Claude needs an OAuth client
  registered first).

## Something's out of date

This app moves fast and these docs are hand-written, not generated: if a page
disagrees with the running app, the app is right. Please open an issue (or a PR)
against whichever page is stale. [`../CLAUDE.md`](../CLAUDE.md) is the denser,
implementation-level counterpart to this directory, aimed at contributors rather
than operators.

## Running from source instead

Everything above is written for someone _operating_ an already-running instance.
If you want to check out the code, run a dev server, and change things, see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) instead, none of the install paths in
Getting Started need Bun, `git`, or a source checkout.
