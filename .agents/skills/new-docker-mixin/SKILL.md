---
name: new-docker-mixin
description:
  Workflow for adding a new concern to DockerService, src/lib/services/docker/,
  as a mixin merged via the TS mixin pattern into the DockerService singleton,
  respecting the load-bearing chain order (networks before containers,
  containers before reconcile). Use when adding new Docker functionality (a new
  lifecycle operation, a new inspection/status method, a new concern file under
  services/docker/) rather than a wholly new service.
user-invocable: true
---

# new-docker-mixin

`DockerService` (`src/lib/services/docker.service.ts`) is a singleton instance
built from real classes merged via the TS mixin pattern — **not** a static
barrel of re-exported functions. This is the reference implementation for this
repo's "prefer real OOP over a static-only class" convention; match its shape,
don't reintroduce a `class Foo { static bar() {...} }` barrel.

## Where the new logic goes

- **A new operational concern with its own state or dependencies on other
  concerns** (the common case: a new lifecycle operation, a new inspection
  method that needs `this.getDocker()` or another mixin's method): add a new
  file under `src/lib/services/docker/`, e.g. `docker/your-concern.ts`,
  exporting a `YourConcernMixin(Base)` function that returns a class extending
  `Base`. Look at `docker/networks.ts` or `docker/reconcile.ts` for the exact
  shape.
- **A pure, stateless transform with no Docker client, no `this`** (like
  `docker/labels.ts`): stays a plain exported function, does **not** need to be
  a mixin at all. Don't wrap something in a mixin class just for consistency if
  it never touches `this`.

## Wiring it in

1. In your new mixin file, extend `Base` (which is ultimately
   `BaseDockerService`, `docker/base.ts`, holding the shared
   `getDocker(remote?)`).
2. Call another concern's method via real inheritance
   (`this.inspectStatus(...)`), never via a cross-module import of another
   concern file directly — that's the whole point of the mixin merge, one flat
   `this` surface.
3. In `docker.service.ts`, add your mixin to the chain. **Order matters and is
   load-bearing** — read the ordering comment already in that file before
   inserting yours. The existing precedent:
   - **networks before containers** (`createAndStartContainer` calls
     `this.connectToProjectNetwork`)
   - **containers before reconcile** (`syncServiceStatus` calls
     `this.inspectStatus`)

   If your mixin calls into an existing one's method, it must be chained _after_
   that one. If nothing calls into yours, order relative to unrelated mixins
   doesn't matter, but keep it next to the mixin(s) it's most related to for
   readability.

4. External call sites always go through the singleton:
   `DockerService.yourNewMethod(...)`, never reaching into
   `services/docker/your-concern.ts` directly. Don't export the mixin's raw
   class as something routes/DTOs import.

## If this is a lifecycle operation reachable from a route

Route handlers, the deploy action, the REST API, the cron scheduler, don't call
`DockerService.createAndStartContainer` (or a new equivalent) directly for a
full deploy — that's wrapped by `$lib/services/deploy.service.ts`'s
`DeploymentService.deployService()`, which adds deployment-row bookkeeping. Only
reach for the raw `DockerService` method directly for a genuinely standalone
operation (start/stop/restart/logs), not a full deploy.

## If this needs to work against a Remote Host

Don't call `DockerService.getDocker()` bare from a new call site. Thread the
connection through `RemoteHostDTO.connectionFor(svc, userId)` the same way every
existing lifecycle operation does (see the Remote hosts section of CLAUDE.md) —
that's the one place ownership scoping and the local-vs-remote-daemon decision
are made.

## Finish

Run the `check-repo` skill. If the change also needs to be mirrored into the
standalone `agent/` sub-project (see its own README — `agent/src/docker.ts`
re-implements, not imports, the equivalent logic since the agent has no access
to this app's source tree at runtime), use the `subproject-sync` agent to keep
the two in sync.
