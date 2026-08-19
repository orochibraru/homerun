# TODO

## Architecture & API

- [x] No sql/drizzle queries in `page.server.ts` — DTOs as OOP classes (e.g. `lib/dto/service-dto.ts`, `class ServiceDTO extends BaseDTO`) with streamlined methods (`get`, `list`, `new`, `add`, `delete`, `update`)
- [x] Make the app API-driven so we can build a CLI on top of the API (REST surface at `src/routes/api/v1/` — services CRUD + deploy/start/stop/restart, projects, templates; DTO-backed, works with both cookie sessions and `x-api-key`/`Bearer`; a CLI client itself isn't built yet)

## Deployment & Container Lifecycle

- [x] When saving settings for a service, prompt user to redeploy
- [x] When deploying, show a live log div with pull/start/health steps ("pulling image", "starting container", "waiting for container to be healthy: retries left, attempt #number, result: ...")
- [x] Add random number to container name to prevent duplicates/failures
- [x] If a service is deploying when reloading/accessing its page, fetch the in-progress deploy logs and hide the deploy button
- [x] In the deployment history, show build outputs (record and store the build log)
- [x] Add ability to deploy a template into a project
- [x] Fix quick actions in `/services` (start/stop/restart/delete from the list)
- [x] Add a web terminal to shell into a running container from the UI — new "Terminal" tab, runs `/bin/sh` in the live container. Auth/audit design: session ownership checked on every request (open/stream/input/close), 15-minute idle auto-close, session start/stop logged via the standard `Logger` pattern (not per-keystroke — see CLAUDE.md for the tradeoff). No WebSocket: input via short POSTs, output via one long-lived streamed GET, same shape as the existing Logs tab. **Real, non-obvious finding from building this**: dockerode's normal `exec.start({hijack:true})` hangs forever under Bun — confirmed via a minimal repro — so the start step is done manually over a raw `Bun.connect()` Unix-socket connection to the Docker daemon instead (`$lib/server/docker/terminal.ts`), verified end-to-end against a real container (real command in, real output back) before wiring it into routes.
- [x] Add an image existence checker, when a user enters an image validate that it exists before saving changes. If it doesn't exist just warn the user don't block saving they may just be preparing the setup.

## Projects & Networking

- [x] Containers in the same project share a network/subnetwork by default (unless isolated deployment is requested, in which case the project gets its own independent network); creating a project/group/folder creates its subnetwork
- [x] When a service deploys, print its hostname and port so other services on the same network can reach it
- [x] Add ability to move a service into or out of a project
- [x] Prefix every container name (and domain/subdomain) created from a project with the project name
- [x] Add a flag to mark an app as DNS-resolvable vs. subnet-only
- [x] Add a new service tab called "Networking" in which we'll control SSL, DNS, Port mapping (DNS: custom-domain mapping, a second Traefik router sharing the primary backend; SSL: read-only — TLS/certResolver is automatic per-service already, nothing to configure; Ports: read-only explainer — no host-port publishing by design, see Docker integration in CLAUDE.md)
- [x] For the new service wizard let's do a stepper instead of one single form, basic info, networking, env, compute etc.. — 4 steps (Basic info / Networking / Environment / Compute) with a clickable step indicator, Back/Next, one `<form>` throughout (steps are hidden with a CSS class, not `{#if}`, specifically so field values survive moving between steps — every field is `$state`-bound, not an uncontrolled `value={}`, for the same reason). On a validation failure the wizard jumps back to step 1 so the error banner/per-field messages are actually visible. Verified live: full multi-field submission (incl. env vars) round-tripped correctly through the real create action.

## Storage & Volumes

- [x] Configure volumes per service, or shared volumes per project (a volume is "shared" simply by mounting it into more than one service — no separate project-volume concept needed)
- [x] Dedicated "Storage" sidebar page to configure storage sources/mount paths for local volumes
- [x] Auto-backup feature to S3-compatible destinations (like Dokploy) — per-volume S3 destination + cron schedule, manual "Backup now", hand-rolled SigV4 client (no AWS SDK dependency). Bind-mount volumes only for v1 (tars the host directory directly); Docker-managed named volumes aren't backed up yet — would need a short-lived helper container to read their content out. No restore flow yet either (upload-only).

## Scheduling & Automation

- [x] Cron wizard per service (disabled by default) to auto-update/redeploy periodically

## Observability & Monitoring

- [x] Error-catching service: an "Errors" tab per service showing error count, details, timestamps, and the corresponding log
- [x] Show system stats: CPU, RAM, GPU, and disk usage
- [x] Ability to view logs from core services (the LocalRun server itself, Traefik)

## Security & Access Control

- [x] General OIDC provider support to gatekeep apps — selectable in the new-service wizard (authenticated vs. unauthenticated access). Built as a Traefik forwardAuth middleware (`service.authRequired`, Networking tab) checked against this app's own session — which already supports arbitrary OIDC providers via the existing `genericOAuth` config, so "log into Homerun via your OIDC provider" + "gate the app behind a valid Homerun session" together deliver the ask. **Known real limitation, verified in testing, not just theorized**: there's no login page mounted on a gated service's own subdomain, so as shipped this blocks _everyone_, including a signed-in admin, unless `AUTH_CROSS_SUBDOMAIN=true` widens the session cookie across the base domain — and even with that enabled, a signed-in admin visiting the gated subdomain directly still wasn't recognized in testing (better-auth's session check appears host-scoped beyond just the cookie's `Domain` attribute; not fully root-caused). Ships with a loud in-UI warning rather than a false promise of working SSO. A real fix needs a proper login-redirect flow for gated subdomains — that's the next step here, not further duct tape.
- [x] Custom SSL certificate handling — per-service cert/key (PEM, encrypted at rest) attachable once a custom domain is set (Networking tab), for domains that aren't a subdomain of this instance's base domain (so the automatic ACME resolver can't cover them). Deliberately doesn't touch the live Traefik container: `$lib/server/docker/custom-ssl.ts` writes the cert/key files + a per-domain Traefik dynamic-config YAML into `TRAEFIK_DYNAMIC_CONFIG_DIR` (unset by default — genuinely inert until configured), which only takes effect once the admin bind-mounts that same path into Traefik and enables its file provider themselves (compose.yaml has the exact commented-out flags/mount to uncomment + `docker compose up -d`). Verified live: the encrypted round-trip, the safe no-op when the dir is unset, and — with the dir configured — real file writes (cert, key, and the generated YAML, contents checked byte-for-byte) plus correct cleanup when the cert is removed. Not verified: Traefik actually picking the file up (would require the user's own container change, out of scope for this session).

## Source & Build Integration

- [x] Add Git providers (including self-hosted, e.g. Gitea) to build apps from a repo source — a service's "Deploy from" is now Docker image (original) or Git repository: any git-clone-able HTTPS URL works equally (GitHub/GitLab/self-hosted Gitea/whatever — provider-agnostic at the clone-URL level, no provider-specific API integration needed for this). Clones a branch/tag (shallow), builds its Dockerfile locally (`$lib/server/docker/git-build.ts`, shells out to `git` + dockerode's `buildImage`), tags it `localrun-build-<slug>:<timestamp>`, deploys that tag like any other image — same `deployService()` pipeline, same live progress log. Verified end-to-end against a real local repo: real clone, real build (visible `Step 1/3...` output in the deployment log), real container running the actual built content. Known gaps: no private-repo credential field (embed a token in the URL yourself), no webhook/auto-deploy-on-push, commit SHAs need to be a branch/tag (shallow clone).
- [x] Support remote servers for deployments/builds, to avoid overloading the main server — a new "Remote Hosts" page registers other Docker daemons (`tcp://host:port`, optionally TLS-secured, or `ssh://user@host` via the system SSH agent); a service's Settings tab picks a "Deploy target" (this host, or one of them). `docker/client.ts`'s `getDocker()` caches one dockerode connection per host and every lifecycle operation (deploy/start/stop/restart/logs/status-sync/account-deletion-cleanup) was threaded through `RemoteHostDTO.connectionFor(svc, userId)` rather than assuming the local socket. Verified end-to-end against a real second Docker connection (a `socat` TCP proxy onto the local socket, standing in for a genuinely separate host) — real deploy, real start/stop, confirmed via `docker inspect` that the container lands on Docker's own default bridge network rather than the app's shared network (a remote-hosted service isn't on the shared network or routed through Traefik — no host port publishing built for it either, so it's reachable only however you set that up yourself). Known gaps: bind-mount volumes are skipped for remote deploys (a local path has no meaning on a remote daemon), builds run remotely too but the git clone itself still happens locally (only the Docker build step is remote).

## Onboarding

- [x] Instance settings/onboarding flow when basic settings aren't configured yet — `/setup` diagnostics page + a dashboard banner (base domain/auth secret/origin/Traefik/Docker socket/SMTP checks, each pointing at the env var that fixes it). Scoped down from the original ask: config stays env-var driven (no DB-backed live-editable settings), and there's no DNS-provider (Cloudflare/Pangolin) API automation for TLS/DNS — that's a real integration project of its own, see [this project](https://github.com/orochibraru/dokploy-to-pangolin) for the shape of it, left for a dedicated pass.

## UI

- [x] Componentize UI elements to ensure UI/UX consistency across the app and proper DevEx — scoped, honest pass, not a full app-wide refactor (an item like this is never really "done"): extracted `$lib/components/form-styles.ts` (the `input`/`label`/`error` Tailwind class strings every form page in this app was independently redefining as identical literals — now a single source, wired into the pages this session touched most: Remote Hosts, service Networking) and `$lib/components/empty-state.svelte` (the icon+title+subtitle[+CTA snippet] pattern repeated across every list page — wired into Storage and Remote Hosts as the demonstrated, verified usage). `StatusBadge` already existed as a precedent before this session. Real duplication still remains in older pages (services/projects/templates lists, the section-card header pattern) — left as future work rather than a risky blanket refactor of pages not touched/re-verified this session.

## Chores

- [x] Fix all Biome errors
- [x] Fixed: `beforeDelete` in `src/lib/server/auth.ts` now also cascade-deletes `project` rows (+ removes their Docker networks) and `storage_volume` rows (+ their `service_volume` join rows) on account deletion, not just services/containers. Verified live: created a project + storage volume, deleted the account, confirmed both rows and the project's Docker network were actually gone.
- [x] Fixed a real bug in `x-api-key`/`Bearer` auth (found while building the REST API): `hooks.server.ts` verified the key correctly but then tried to recover a session via `getSession()`'s API-key session-mocking, which is off by default (`enableSessionForAPIKeys`) — so `locals.user` was silently never set and every API-key request 401'd. Fixed by looking the user up directly by the verified key's `referenceId`. This path was apparently never exercised end-to-end before (no route used to require it).
