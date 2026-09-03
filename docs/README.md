# Homerun docs

Homerun is a self-hosted, single-user PaaS: point at a Docker image or a git
repo, fill in a form, deploy: Traefik routes it to `<slug>.yourdomain.com` with
TLS. Single host, local Docker socket, no multi-node orchestration.

This directory is plain Markdown for now: no generated site yet (see
[`../TODO.md`](../TODO.md)). Read it straight from the repo, or on your GitHub
remote's file browser.

## Guides

1. **[Getting started](getting-started.md)**: install (the one-liner, Docker
   Compose, or from source), first boot, the onboarding wizard.
2. **[Configuration](configuration.md)**: every environment variable, and which
   ones are also live-editable from `/settings`.
3. **[Services](services.md)**: deploying from an image or a git repo, env vars,
   volumes, networking, compute limits, cron redeploy, logs, and the web
   terminal.
4. **[Projects & templates](projects-and-templates.md)**: grouping services on a
   shared network, one-click templates, and saving your own.
5. **[Storage & backups](storage-and-backups.md)**: bind-mount and
   Docker-managed volumes, mounting them into services, S3-compatible backups.
6. **[Remote hosts & the Homerun Agent](remote-hosts-and-agent.md)**: deploying
   to a second machine, autoscale-by-migration, the standalone agent and
   installer.
7. **[Users & access](users-and-access.md)**: roles, invites, OAuth/OIDC login,
   the per-service auth gate, API keys.
8. **[API & CLI](api-and-cli.md)**: the REST API, the live Swagger UI, and the
   `homerun` CLI.
9. **[FAQ & limitations](faq-and-limitations.md)**: what's genuinely finished,
   what's a known gap, and what's on the roadmap.

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
