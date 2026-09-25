---
name: new-docker-mixin
description:
  Workflow for adding a new concern to DockerService, src/lib/services/docker/,
  as a mixin merged via the TS mixin pattern into the DockerService singleton,
  respecting the load-bearing chain order (networks before containers,
  containers before reconcile). Use when adding new Docker functionality (a new
  lifecycle operation, a new inspection/status method, a new concern file under
  services/docker/) rather than a wholly new service.
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
   - **containers before one-off** (`runOneOff` calls `this.pullImage`)
   - **containers and swarm before reconcile** (`syncServiceStatus` calls
     `this.inspectStatus`/`this.inspectSwarmServiceStatus`)

   If your mixin calls into an existing one's method, it must be chained _after_
   that one. If nothing calls into yours, order relative to unrelated mixins
   doesn't matter, but keep it next to the mixin(s) it's most related to for
   readability.

4. External call sites always go through the singleton:
   `DockerService.yourNewMethod(...)`, never reaching into
   `services/docker/your-concern.ts` directly. Don't export the mixin's raw
   class as something routes/DTOs import.

## If this is a lifecycle operation reachable from a route

Route handlers, the deploy action, the REST API, the cron scheduler, don't build
a container/swarm-service create body directly for a full deploy — the
create-and-roll-out step itself now runs in the Go worker
(`internal/jobs/deploy/container.go`/`swarm.go`, see `worker.md`), reached only
through `$lib/services/deploy.service.ts`'s `DeploymentService.deployService()`
/ `enqueueDeploy()`, which build the worker spec and add deployment-row
bookkeeping. Only reach for a raw `DockerService` method directly for a
genuinely standalone operation (start/stop/restart/logs), not a full deploy.

## If this needs to work against a Remote Host

A registered remote host (`RemoteHostDTO`, `remote_host` table) is a build
server, nothing else — every general remote-deploy branch was removed (migration
`drizzle/0022_shiny_shiva.sql`), see `.agents/notes/docker.md`'s "Build servers"
section. Deploys and lifecycle operations always run on the local daemon (or the
local swarm manager); don't add a remote-host path to a lifecycle mixin. A git
build to a `"docker"` build server is resolved the same way, through
`RemoteHostDTO.resolveBuildTarget(hostId)` (the one place a host id becomes a
`RemoteExecutionTarget`), but it's the Go worker that opens the actual remote
connection now (`internal/jobs/deploy/build.go`'s `dockerapi.NewRemote`), not
`DockerService.getDocker(remote)`.

## Finish

Run the `check-repo` skill. If the change also needs to be mirrored into
`cmd/worker/`'s agent mode (see `cmd/worker/README.md` —
`internal/agent/stats.go` re-implements, not imports, `SystemStatsService`'s
equivalent logic since agent mode has no access to this app's database or config
at runtime; `internal/agent/build.go`/`git.go` are imported directly by both the
worker's own jobs and agent mode, no sync needed there), use the
`subproject-sync` agent to keep the two in sync.
