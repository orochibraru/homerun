# Homerun docs

Homerun is a self-hosted, single-user PaaS: point at a Docker image or a git
repo, fill in a form, deploy: Traefik routes it to `<slug>.yourdomain.com` with
TLS. Single host, local Docker socket, no multi-node orchestration.

This directory is plain Markdown, the source of truth: read it straight from the
repo, or on your GitHub remote's file browser. The
[website](https://homerun.orochibraru.com) renders these same files from its own
separate repository; it's a companion renderer, not a second copy to keep in
sync by hand.

## Guides

1. **[Getting started](getting-started.md)**: install (the one-liner or Docker
   Compose), first boot, the onboarding wizard, and deploying your first
   service.
2. **[Configuration](configuration.md)**: what you set in the dashboard (almost
   everything), the three values the container needs before it can start, and
   the optional YAML file for config-as-code setups.
3. **[Services](services.md)**: deploying from an image or a git repo, importing
   a compose file, the job queue behind every deploy, env vars, linking one
   service to another, volumes, networking and DNS automation, the login wall,
   compute limits, swarm mode, cron redeploys, cron jobs, logs, and the web
   terminal.
4. **[Projects & templates](projects-and-templates.md)**: grouping services on a
   shared network, the built-in app catalog, quick deploys, linked companion
   containers, and saving your own.
5. **[Storage & backups](storage-and-backups.md)**: bind-mount and
   Docker-managed volumes, mounting them into services, reusable S3 destinations
   and scheduled backups of either volume kind.
6. **[Build servers & the Homerun Agent](remote-hosts-and-agent.md)**: building
   images on a second machine, the standalone agent and installer.
7. **[Users & access](users-and-access.md)**: roles, invites, OAuth/OIDC login,
   your profile and API keys, the per-service auth gate, appearance preferences.
8. **[Operations & maintenance](operations.md)**: the dashboard, setup
   diagnostics, system logs, Docker cleanup, the scheduling view, notifications,
   and upgrading.
9. **[API & CLI](api-and-cli.md)**: the REST API, the live Swagger UI, and the
   `homerun` CLI.
10. **[FAQ & limitations](faq-and-limitations.md)**: what's genuinely finished,
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
