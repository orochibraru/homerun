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
- [ ] Add a web terminal to shell into a running container from the UI
- [x] Add an image existence checker, when a user enters an image validate that it exists before saving changes. If it doesn't exist just warn the user don't block saving they may just be preparing the setup.

## Projects & Networking

- [x] Containers in the same project share a network/subnetwork by default (unless isolated deployment is requested, in which case the project gets its own independent network); creating a project/group/folder creates its subnetwork
- [x] When a service deploys, print its hostname and port so other services on the same network can reach it
- [x] Add ability to move a service into or out of a project
- [x] Prefix every container name (and domain/subdomain) created from a project with the project name
- [x] Add a flag to mark an app as DNS-resolvable vs. subnet-only
- [x] Add a new service tab called "Networking" in which we'll control SSL, DNS, Port mapping (DNS: custom-domain mapping, a second Traefik router sharing the primary backend; SSL: read-only — TLS/certResolver is automatic per-service already, nothing to configure; Ports: read-only explainer — no host-port publishing by design, see Docker integration in CLAUDE.md)

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

- [x] General OIDC provider support to gatekeep apps — selectable in the new-service wizard (authenticated vs. unauthenticated access). Built as a Traefik forwardAuth middleware (`service.authRequired`, Networking tab) checked against this app's own session — which already supports arbitrary OIDC providers via the existing `genericOAuth` config, so "log into Homerun via your OIDC provider" + "gate the app behind a valid Homerun session" together deliver the ask. **Known real limitation, verified in testing, not just theorized**: there's no login page mounted on a gated service's own subdomain, so as shipped this blocks *everyone*, including a signed-in admin, unless `AUTH_CROSS_SUBDOMAIN=true` widens the session cookie across the base domain — and even with that enabled, a signed-in admin visiting the gated subdomain directly still wasn't recognized in testing (better-auth's session check appears host-scoped beyond just the cookie's `Domain` attribute; not fully root-caused). Ships with a loud in-UI warning rather than a false promise of working SSO. A real fix needs a proper login-redirect flow for gated subdomains — that's the next step here, not further duct tape.
- [ ] Custom SSL certificate handling

## Source & Build Integration

- [ ] Add Git providers (including self-hosted, e.g. Gitea) to build apps from a repo source
- [ ] Support remote servers for deployments/builds, to avoid overloading the main server

## Onboarding

- [x] Instance settings/onboarding flow when basic settings aren't configured yet — `/setup` diagnostics page + a dashboard banner (base domain/auth secret/origin/Traefik/Docker socket/SMTP checks, each pointing at the env var that fixes it). Scoped down from the original ask: config stays env-var driven (no DB-backed live-editable settings), and there's no DNS-provider (Cloudflare/Pangolin) API automation for TLS/DNS — that's a real integration project of its own, see [this project](https://github.com/orochibraru/dokploy-to-pangolin) for the shape of it, left for a dedicated pass.

## UI

- [ ] Componentize UI elements to ensure UI/UX consistency across the app and proper DevEx

## Chores

- [x] Fix all Biome errors
- [ ] `beforeDelete` in `src/lib/server/auth.ts` cleans up a deleted user's services/containers but not their `project` rows — orphaned projects survive account deletion (found while testing project-slug prefixing). Not urgent (FK pragma is off, so it's just clutter, not a leak), but should get the same explicit-cascade treatment as services. Same gap exists for `storage_volume` rows (found while testing S3 backups) — same fix, same low urgency.
- [x] Fixed a real bug in `x-api-key`/`Bearer` auth (found while building the REST API): `hooks.server.ts` verified the key correctly but then tried to recover a session via `getSession()`'s API-key session-mocking, which is off by default (`enableSessionForAPIKeys`) — so `locals.user` was silently never set and every API-key request 401'd. Fixed by looking the user up directly by the verified key's `referenceId`. This path was apparently never exercised end-to-end before (no route used to require it).
