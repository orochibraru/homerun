# Routing and page structure

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## A service's tabs

`services/[serviceId]/` is the reference tab layout (see Conventions in
`CLAUDE.md`), and the set changed: **Revisions** is its own tab (the deployment
history that used to sit at the bottom of Overview, now with the `image:tag`
that ran, its digest, how long it took and — for a git build — the commit,
linked to the provider), and **Observability** is Logs and Errors merged into
one page, since flipping between "what is it printing" and "what went wrong" was
the common path. `logs/` still exists as a **route without a page**: its
`+server.ts` is the SSE stream `live-log-viewer.svelte` fetches.

Overview now leads with the service's own resource chart and a **Connections**
panel (what it needs, what needs it, derived from env vars naming another
service's slug), plus the connection URLs for a datastore image.

## Routing: dashboard-first, with exactly one public page

`src/routes/(protected)/` is a route group living at `/` itself (not
`/dashboard`), its `+layout.server.ts` is the single auth guard, redirecting to
`/auth/sign-in` (or `/auth/sign-up` on a blank instance) when signed out,
**and** one half of the onboarding guard, redirecting to `/onboarding` when the
instance hasn't finished it (see Onboarding below for the other half,
`src/routes/onboarding/` is its own top-level route, not nested under
`(protected)/`, with its own reverse-direction `load`). There is no public
marketing page.

**Two unauthenticated surfaces, and only two**: `src/routes/auth/**`, and
`src/routes/status/[slug]` — a published status page, deliberately outside
`(protected)/` so a signed-out visitor can read it. Its gate is not a layout but
the DTO finder it calls: `StatusPageDTO.getPublicBySlug()` filters on
`isPublic = true` and takes no `userId`, so an unpublished page 404s for
everyone. Keep that guard in the DTO rather than the route — it's the only thing
standing between a slug and someone else's service list.

What that page renders is a security decision too: service names, up/down and an
uptime percentage, never an image, port, hostname, or a probe's own error text,
all of which describe infrastructure. `tests/e2e/ui-status-page.spec.ts` asserts
both halves (a published page is readable signed out and leaks none of that; an
unpublished one 404s).

The sidebar nav is grouped into four labeled categories (`category` on each item
in `(protected)/+layout.svelte`'s nav array, color-coded per category, see
Appearance preferences below for the per-user "single accent color" override):

- **Workspace**: **Overview** (dashboard stats + recent deployments),
  **Services**, **Stacks**, **Templates**, **Cron Jobs** (user-defined scheduled
  tasks, see Cron jobs below), **Status Page** (service health and the public
  pages themselves, see Status pages in `services-and-templates.md`).
- **Infrastructure**: **Storage**, **Backups** (backup-run history + "Run now",
  see S3 backups below), **S3 Destinations** (reusable, named backup targets),
  **Remote Hosts**, **Scheduling** (one instance-wide view of every cron
  redeploy, enabled cron job and backup schedule, plus the job queue).
- **Integrations**: **Git Providers**, **Build Cache** (registry credentials for
  cross-build cache reuse, see Git-based builds below), **Notification
  Channels** (webhook/Discord/email destinations, see Outbound notification
  channels in `observability.md`; which events each channel gets is set on
  `/profile/notifications` instead, not in this nav), **API Docs**.
- **Administration**: **Users** (admin-only), **Authentication** (admin-only,
  sign-in methods for the instance and the per-app login wall, see
  Authentication page below), **Settings** (admin-only), **System Logs**,
  **Docker Cleanup** (admin-only, see below).

Not in the nav but real routes: `/profile/**` (reached from the profile menu,
see Appearance preferences below), `/cli-auth` (the CLI device-code approval
page), `/app-auth` (the sign-in screen a gated app's visitors are redirected to,
deliberately top-level rather than under `(protected)/` since it has to render
for signed-out visitors, see Per-app login wall below). The bell's own
read/delete endpoints used to live at `/notifications/**` and are now remote
commands instead, see Remote functions below. `(protected)/+layout.svelte`
filters the nav array on `data.user.role === "admin"` before rendering, a
developer sees everything else unchanged (their own services/stacks, already
isolated per-user by every DTO's `userId` scoping). `/setup` was removed (see
Setup diagnostics below) in favor of the dashboard banner deep-linking into
`/settings`.

`src/routes/(protected)/services/`:

- `+page.svelte`, list, grouped by stack (with an "Ungrouped" bucket when more
  than one group exists), server-side search/status/stack filters and a
  list/card view toggle (`entity-toolbar.svelte`/`ViewMode`, see Shared UI
  components above) plus a `<Pagination>` footer (see Server-side list
  pagination above; `+page.server.ts`'s `load` calls
  `ServiceDTO.listWithStackNamesPaged` and `ServiceDTO.listFilterFacets` for the
  pills, so the filter options stay stable across pages), inline per-row
  start/stop/restart/delete actions plus a checkbox-driven multi-select
  (select-all scoped to whatever's on the **current page**, a sticky bottom bar
  with Start/Stop/Restart/Delete/Clear; paginating or changing the
  search/filters drops anything selected that's no longer on screen rather than
  silently submitting it with a bulk action). Both single-row and bulk actions
  go through four new `ServiceLifecycleService` methods
  (`startService`/`stopService`/`restartService`/`deleteService`,
  `service-lifecycle.service.ts`, each taking a `ServiceDTO` and branching on
  `svc.swarmServiceId` internally) rather than each call site re-deriving that
  branch; the pre-existing containerId-level `start`/`stop`/`restart`/`remove`
  methods are unchanged and still used elsewhere. `+page.server.ts`'s single
  `bulk` action takes repeated `serviceId` fields plus an `op` (from the clicked
  submit button's own name/value) and runs every resolved service through
  `Promise.allSettled` (this repo's `noAwaitInLoops` lint rule forbids an await
  loop), returning `{succeeded, failed, op}` so the toast reports a partial
  result, or `fail(400)` with the first rejection's message if every one failed.
  Bulk delete is gated behind `ConfirmDialog`'s typed-phrase confirm
  (`delete N services`); single-row delete requires typing the service's own
  name. `load` also now calls `allowLongRequest(platform)` (it didn't before,
  see Server-side list pagination above for the status-sync fix that came with
  it and Long-running requests below for why that matters).
- `import/+page.svelte`, paste a compose file, preview what it maps onto, then
  create (and optionally deploy) the stack : see Compose import below. Reached
  from the "Import compose" button next to "Deploy a Service" on the list.
- There is no `services/migrate` any more: migrating from Dokploy/Coolify is the
  admin-only `settings/migrate/` tab (source picker, then one nested route per
  source), see "Migrating from Dokploy or Coolify" in
  `services-and-templates.md`.
- `new/+page.svelte`, click-config create form, a 4-step wizard (Basic info /
  Networking / Environment / Compute, one `<form>` throughout, steps hidden via
  a CSS class rather than `{#if}` so field state survives navigating between
  them); accepts `?stackId=` and/or `?templateId=` query params to pre-fill from
  a stack or template context. "Deploy from" toggles between a Docker image and
  a git repo (see Git-based builds below), same toggle repeated on the service's
  own Source tab for editing after creation. Two submit actions share one
  `createServiceFromForm()` helper (`new/+page.server.ts`) that validates +
  creates the row: `create` (secondary button, "Create service", persists config
  only, same as before) and `createAndDeploy` (primary button, "Create and
  Deploy", calls `allowLongRequest(platform)` then
  `DeploymentService.deployService()` before redirecting straight to the new
  service's Overview tab instead of the services/stack list). A min-height
  wrapper around the step content keeps the Next/Back button row's vertical
  position stable as steps of different heights swap in.
- `[serviceId]/+layout.server.ts`, ownership guard (id **and** userId must
  match, else 404) + syncs live Docker status on every visit. Tabs: **Overview**
  (deploy/start/stop/restart, live deploy progress panel, deployment history
  with expandable per-deployment logs, plus an embedded `LiveLogViewer`, see
  Logs below, shown once deployed so recent output is visible without switching
  tabs), **Source** (Deploy-from image/git toggle, image+tag or git repo fields,
  private registry, `updateSourceSchema`, its own `updateSource` action; split
  off Settings so "what gets deployed" has its own tab), **Logs** (live-streamed
  via a `+server.ts` GET returning a chunked `ReadableStream`, rendered through
  `$lib/components/live-log-viewer.svelte`, the same component embedded in
  Overview), **Env Vars**, **Volumes** (mount/unmount StorageVolumes, including
  a "New volume" modal, `$lib/components/new-volume-fields.svelte` shared with
  `/storage/new`, so a volume can be created and mounted without leaving the
  service), **Networking** (custom domain mapping; an **Access** section holds
  the per-app login wall, its allowed sign-in methods and its user/email/group
  allowlists, `updateAppAuth`, see Per-app login wall below; a **Network**
  section holds container port, protocol (tcp/udp/both), network mode
  (bridge/host, see below), and DNS-resolvability, `updatePortsSchema`, its own
  `updatePorts` action, moved off Settings; SSL section is a read-only explainer
  for the automatic-vs-custom-cert split, host ports are still never
  _published_/mapped by design even though host network mode now exists, see
  below; **every one of those settings is a Traefik label written when the
  container is created**, so saving one changes nothing about the container
  that's already running, which is why an already-deployed service shows an
  amber notice and a `?/redeploy` button at the top of this tab rather than
  leaving the user to work out why their custom domain 404s), **Compute**
  (cpu/memory limits, `updateComputeSchema`, its own `updateCompute` action,
  moved off Settings), **Terminal** (interactive shell into the live container,
  see below), **Errors** (failed deployments + a live "container currently down"
  banner + "Application errors", persisted app-level warn/error `Logger` output
  attributed to this service, see `app_log`/`AppLogDTO` in Data model below;
  plus, when `currentStatus === "missing"`, a distinct banner with a "Resolve"
  button, `?/resolveOrphan`, calling `ServiceDTO.resolveOrphan()` to clear the
  stale `containerId`/`swarmServiceId` and put the row back to a clean,
  never-deployed shape so Deploy works again, see the `"missing"`
  `ContainerStatus` note under Docker integration below), **Settings**
  (name/slug/restart-policy, move between stacks, save-as-template,
  auto-redeploy cron schedule, danger-zone delete, image/git/registry,
  port/network and cpu/memory fields all moved to their own tabs, see
  Source/Networking/Compute above)
- `[serviceId]/deployments/[deploymentId]/events/+server.ts`, the SSE stream the
  Overview tab listens on while a deploy is in flight (see Live progress below),
  and `.../progress/+server.ts`, the older `{log, status}` JSON endpoint, now
  the client's fallback when the stream can't be held open. The client
  pre-generates the deployment id itself (`randomId()` from `$lib/random-id.ts`,
  set on the form via `formData.set("deploymentId", ...)` in `use:enhance`'s
  pre-submit callback) so it can start listening _before_ the deploy request
  even resolves, which is why the stream waits for the row instead of 404ing.
  **It must not call `crypto.randomUUID()` directly, and that's a real reported
  bug, not a style preference**: that API is secure-context-gated in browsers,
  so on a plain-HTTP instance at a bare IP (exactly what the installer's
  `--mode=full` produces) it's `undefined`, the pre-submit callback threw
  `TypeError: crypto.randomUUID is not a function` before the submission ever
  reached the server, and since `onStart` had already set `pendingAction`,
  Deploy spun forever with nothing queued and no toast (`toast.promise` is
  called after `onSubmit`). `randomId()` falls back to `crypto.getRandomValues`,
  which carries no such restriction. Server-side `crypto.randomUUID()` (every
  DTO's id) is fine, this only applies to code that runs in the browser.
  `navigator.clipboard` is gated the same way, which `profile/clients` already
  handles by catching and telling the user to copy manually. Both are
  status-driven (they end once the deployment reaches a terminal status), which
  is also what makes resuming the progress view after a mid-deploy page reload
  work, `onMount` checks the latest deployment's status and `svc.currentStatus`
  and reattaches if either is still in-flight.

`src/routes/(protected)/stacks/`, `templates/`, `storage/`, `authentication/`
mirror this pattern (list + `new/` create route + `[id]` detail where
applicable). `system-logs/` streams the Traefik container's own logs (see Docker
integration below).
