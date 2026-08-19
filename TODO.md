# TODO

## Architecture & API

- [x] No sql/drizzle queries in `page.server.ts` — DTOs as OOP classes (e.g. `lib/dto/service-dto.ts`, `class ServiceDTO extends BaseDTO`) with streamlined methods (`get`, `list`, `new`, `add`, `delete`, `update`)
- [ ] Make the app API-driven so we can build a CLI on top of the API (groundwork done — DTOs give a clean layer a REST surface can call; no actual API/CLI endpoints yet)

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
- [ ] Add a new service tab called "Networking" in which we'll control SSL, DNS, Port mapping

## Storage & Volumes

- [x] Configure volumes per service, or shared volumes per project (a volume is "shared" simply by mounting it into more than one service — no separate project-volume concept needed)
- [x] Dedicated "Storage" sidebar page to configure storage sources/mount paths for local volumes
- [ ] Auto-backup feature to S3-compatible destinations (like Dokploy)

## Scheduling & Automation

- [ ] Cron wizard per service (disabled by default) to auto-update/redeploy periodically

## Observability & Monitoring

- [x] Error-catching service: an "Errors" tab per service showing error count, details, timestamps, and the corresponding log
- [x] Show system stats: CPU, RAM, GPU, and disk usage
- [x] Ability to view logs from core services (the LocalRun server itself, Traefik)

## Security & Access Control

- [ ] General OIDC provider support to gatekeep apps — selectable in the new-service wizard (authenticated vs. unauthenticated access)
- [ ] Custom SSL certificate handling

## Source & Build Integration

- [ ] Add Git providers (including self-hosted, e.g. Gitea) to build apps from a repo source
- [ ] Support remote servers for deployments/builds, to avoid overloading the main server

## Onboarding

- [ ] Instance settings/onboarding flow when basic settings aren't configured yet (domain name, DNS provider — e.g. Cloudflare, Pangolin, automatable via API for TLS/DNS ops — SSL usage, etc.), [this project](https://github.com/orochibraru/dokploy-to-pangolin) is a good example

## UI

- [ ] Componentize UI elements to ensure UI/UX consistency across the app and proper DevEx

## Chores

- [x] Fix all Biome errors
- [ ] `beforeDelete` in `src/lib/server/auth.ts` cleans up a deleted user's services/containers but not their `project` rows — orphaned projects survive account deletion (found while testing project-slug prefixing). Not urgent (FK pragma is off, so it's just clutter, not a leak), but should get the same explicit-cascade treatment as services.
