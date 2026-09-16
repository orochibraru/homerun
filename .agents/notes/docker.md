# Docker integration

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Docker integration (`src/lib/services/docker.service.ts`, `src/lib/services/docker/`)

`DockerService` (`docker.service.ts`) is a singleton instance
(`export const DockerService = new DockerServiceClass()`) of a class built from
real per-concern classes merged via the TS mixin pattern, **not** a static
barrel re-exporting loose functions (see the OOP convention note above; this
module is its reference implementation). Every route/DTO imports `DockerService`
from there and calls instance methods on it (`DockerService.pullImage(...)`),
never reaching into `services/docker/*` directly, that part of the contract is
unchanged from before the mixin refactor. Each concern file under
`services/docker/` exports a `SomethingMixin(Base)` function returning a class
that extends `Base` (ultimately `BaseDockerService`, `docker/base.ts`, holds the
shared `getDocker(remote?)`); `docker.service.ts` chains all of them and
instantiates once. A concern that calls another's method does it via real
inheritance (`this.inspectStatus(...)`), which is also why the chain has a
load-bearing order: networks before containers (`createAndStartContainer` calls
`this.connectToStackNetwork`), containers before reconcile (`syncServiceStatus`
calls `this.inspectStatus`), containers before one-off (`runOneOff` calls
`this.pullImage`), see the ordering comment in `docker.service.ts` before
reordering the chain.

- `client.ts`, HMR-safe `dockerode` singleton, socket path from config; not a
  mixin itself, `BaseDockerService.getDocker` wraps its exported `getDocker()`
  function. → `DockerService.getDocker`.
- `labels.ts`, pure label-building (no Docker client, no state), stays a plain
  exported function rather than a mixin: every container gets
  `homerun.managed=true` + `homerun.service.id=<id>`, plus Traefik discovery
  labels (unless `dnsResolvable` is false, then only the two managed labels, no
  `traefik.*` at all, so it never gets a router). `listManagedContainers()` and
  any host-scanning code **must** filter on `homerun.managed=true`, this app
  must never touch a container it didn't create. When the service belongs to a
  stack, the public subdomain is `<stackSlug>-<slug>.<baseDomain>` (`stackSlug`
  param, optional). When `customDomain` is set, a second router
  (`<slug>-custom`) is added pointing at the _same_
  `traefik.http.services.<slug>` backend, one loadbalancer config, two hostnames
  reaching it, not a duplicated service block. When `authRequired` is set, a
  forwardAuth middleware is attached to every router for the service, pointing
  at `authCheckUrlFor(serviceId)` — `config.authCheckUrl` with a `?service=<id>`
  query param, so the gate identifies the service from the URL rather than
  having to resolve `X-Forwarded-Host` back to a slug or custom domain — plus
  `authResponseHeaders` for `GATE_IDENTITY_HEADERS`. Because these are labels,
  turning the wall on or off only takes effect on the next deploy.
- `networks.ts`, `DockerNetworkMixin`, per-stack Docker networks.
  `stackNetworkName(stackId)` is deterministic (`homerun-stack-<id>`, no
  separate id stored, stays a plain exported pure function).
  `ensureStackNetwork`/`removeStackNetwork` (idempotent create/remove, called
  from `StackDTO.create`/`cascadeDelete`) and
  `connectToStackNetwork(containerId, stackId, alias)` attaches a container to
  its stack's network under a DNS alias equal to the service's slug (the
  _internal_ alias is never stack-prefixed, only the container name and public
  subdomain are, sibling services keep addressing each other by plain slug) →
  `DockerService.ensureStackNetwork`/`removeStackNetwork`/`connectToStackNetwork`.
  `connectToStackNetwork` calls `ensureStackNetwork` itself first, same
  re-assert-on-every-deploy shape as `createAndStartContainer`'s own
  `ensureSharedNetwork()` call below: a network a prune or a Docker Cleanup run
  removed out from under a still-live stack row gets recreated, rather than
  failing every subsequent deploy with a raw dockerode 404.
- `core-services.ts`, `DockerCoreServicesMixin`, the Traefik container itself :
  `findTraefikContainer`/`restartTraefikContainer`/`updateTraefikContainer`
  (image-only recreate), plus **`applyTraefikFlags(flags)`**, which rewrites
  `--key=value` entries on the _running_ container's command line and recreates
  it from its own inspected config. That one crosses the line
  `updateTraefikContainer` documents ("never invents new command-line flags") on
  purpose: Traefik reads its ACME account, its providers and its entrypoints
  from **static** configuration at process start, so a dashboard field that only
  writes a database row is a field that does nothing. Two callers today:
  `applyAcmeEmail` (Settings → Networking) and `enableSwarmMode`. Both no-op
  when every flag already holds the requested value, so saving an unchanged
  section never bounces the proxy. `applyFlags` itself is a pure exported
  function with its own unit test (`tests/unit/app/traefik-flags.test.ts`) : it
  matches whole keys, so `providers.docker` never clobbers
  `providers.docker.exposedbydefault`, and a null value removes a flag.
- **Switching orchestration mode actually prepares the host.**
  `enableSwarmMode()` runs `docker swarm init` if the daemon isn't a manager,
  ensures an **attachable overlay** network, attaches Traefik to it and turns on
  `--providers.swarm`. The overlay is deliberately a _second_ network,
  `<networkName>-swarm` (`swarmNetworkName()`): swarm services can only join an
  overlay, the shared network already exists as a bridge with the app and
  Traefik attached, and a live bridge network can't be converted in place.
  `buildContainerLabels` therefore takes a `networkName` so a swarm service's
  `traefik.docker.network` points at the overlay. `disableSwarmMode()` removes
  the provider flags and **leaves the swarm running** :
  `docker swarm leave --force` would kill every swarm service on the host,
  including ones this app never created, which is not something a dashboard
  select should do behind your back.
- `containers.ts`, `DockerContainerMixin` (the old `service.ts`, renamed to
  avoid reading as "the Service service" next to `dto/service-dto.ts`), the
  operational surface, merged in right after the network mixin (see the ordering
  note above):
  - `pullImage(image, tag, auth?, onProgress?)`, `onProgress` is called once per
    layer _status change_ (not per byte-tick, dockerode's raw progress events
    are far too chatty to log one-for-one), used to build the live
    deploy-progress log. → `DockerService.pullImage`.
  - `createAndStartContainer(params, onProgress?)`, container names include a
    random suffix (`homerun-[<stackSlug>-]<slug>-<hex8>`) so a redeploy never
    collides on "name already in use"; the _previous_ container for a service is
    found by its `homerun.service.id` label (`#findServiceContainer`, a private
    method), not by name, since names are no longer stable across deploys. The
    container is aliased as its slug on the shared network
    (`NetworkingConfig.EndpointsConfig`) so other services can reach it at
    `http://<slug>:<containerPort>` regardless of the randomized name; if
    `params.stackId` is set, it also joins that stack's network under the same
    alias (`this.connectToStackNetwork`, inherited from the network mixin).
    `params.volumes` (from `ServiceVolumeDTO.listForService`) becomes
    `HostConfig.Binds` (`"source:containerPath[:ro]"`, covers both bind-mounts
    and named volumes with the same syntax). Don't call this directly from a new
    route, go through `$lib/services/deploy.service.ts`'s
    `DeploymentService.deployService()` instead (see above), which wraps it with
    deployment-row bookkeeping. → `DockerService.createAndStartContainer`.
  - `start/stop/restartContainer`, `removeContainer`, `inspectStatus` →
    `ContainerStatus`, `containerHealth` → the container's own `State.Health`
    verdict (`null` when the image declares no `HEALTHCHECK`, which is the
    common case; the uptime probe prefers it over any probe of its own, see
    `observability.md`), `streamLogs` (follow-mode web `ReadableStream`),
    `buildAuthConfig`, all exposed the same way, `DockerService.<name>`.
    `ContainerStatus` (`$lib/types.ts`) has a `"missing"` value alongside
    pending/pulling/starting/running/stopped/failed, for a container Docker
    can't find at all (a 404 on `inspect()`, e.g. removed manually outside the
    app, `docker rm`), distinct from `"failed"` (the container still exists but
    exited non-zero); `inspectStatus` only returns `"missing"` for a real 404,
    any other inspect error still falls back to `"failed"` as before. See the
    Errors tab bullet above for the "Resolve" action
    (`ServiceDTO.resolveOrphan()`) this status backs, and Remote hosts/Homerun
    Agent below, `agent-client.service.ts`'s `inspectStatus` and
    `packages/agent/docker.ts`'s `ContainerNotFoundError` (mapped to a real HTTP
    404 by `packages/agent/http.ts`) make the same distinction for an
    agent-backed host. Docker doesn't strip a container's own ANSI color codes
    from its stdout, every raw-log-line surface (the Logs tab, deploy progress
    panel, deployment history, Errors tab) renders each line through
    `$lib/components/ansi-line.svelte` (backed by `$lib/ansi.ts`'s
    `parseAnsiLine()`), which splits a line into styled `<span>`s rather than
    using `{@html}`, no injection surface even though the source is a live
    container's own output.
- `reconcile.ts`, `DockerReconcileMixin`,
  `syncServiceStatus`/`syncAllServiceStatuses`: poll-on-page-load status
  reconciliation, merged in after the container mixin so `this.inspectStatus` is
  available. There is intentionally no background worker or Docker event
  subscriber (yet, see Planned features). →
  `DockerService.syncServiceStatus`/`syncAllServiceStatuses`.
- `core-services.ts`, `DockerCoreServicesMixin`, `findTraefikContainer()`, a
  deliberate narrow exception to the managed-label-only rule: read-only (logs
  only, never lifecycle) lookup of the Traefik container by image-name prefix,
  backing the System Logs page. →
  `DockerService.findTraefikContainer`/`restartTraefikContainer`/`updateTraefikContainer`.
- `cleanup.ts`, `DockerCleanupMixin`, host-wide (not per-service, deliberately
  the one mixin that isn't scoped to `homerun.managed=true` containers, see
  Docker Cleanup below) `docker.df()`-backed preview (`getCleanupPreview()` →
  `CleanupPreview`) plus
  `pruneContainers`/`pruneImages(all?)`/`pruneNetworks`/`pruneBuildCache`/
  `pruneVolumes`/`pruneSystem`, thin wrappers over dockerode's own
  `prune*`/`pruneBuilder` calls. → `DockerService.getCleanupPreview`/
  `pruneContainers`/`pruneImages`/`pruneNetworks`/`pruneBuildCache`/
  `pruneVolumes`/`pruneSystem`.
- `one-off.ts`, `DockerOneOffMixin`, `runOneOff(params)`: pull-if-missing,
  create, start, wait, collect stdout/stderr, remove, for the two places that
  need a container as a _tool_ rather than as a service (reading a
  Docker-managed named volume out for a backup, see S3 backups above; running a
  user-defined cron job's image, see Cron jobs below). Needs the container mixin
  ahead of it in the chain (`this.pullImage`). **`Tty` is deliberately false
  here**, unlike `createAndStartContainer`, so Docker's own stream framing keeps
  stdout and stderr apart : a caller reading a binary tarball off stdout must
  not get stderr interleaved into it, which is exactly what a TTY container
  would do. `timeoutMs` kills the container rather than leaving it running, and
  the result carries `timedOut` so the caller can say so; the container is
  removed in a `finally` either way. The attached socket is `destroy()`ed
  explicitly once the run finishes : without that it stays open and keeps Bun's
  event loop alive, leaking one connection per run in a long-lived server. →
  `DockerService.runOneOff`.
- `image-scan.ts`, `DockerImageScanMixin`, merged outermost (after cleanup,
  needs `runOneOff`/`pullImage`/`ensureSharedNetwork`), the mirror and the
  scanner. `ensureImageMirror()` lazily creates `homerun-mirror` (`registry:2`,
  `homerun-mirror-data` volume, shared network, `127.0.0.1:5055->5000`,
  `unless-stopped`, labelled `homerun.infra=mirror` and **not**
  `homerun.managed`, so nothing that lists managed containers ever treats it as
  a service), same core-infra exception as Traefik. `copyToMirror` runs
  `quay.io/skopeo/stable` via `runOneOff` on the shared network
  (`skopeo copy --quiet --dest-tls-verify=false --digestfile /dev/stdout`),
  passing registry credentials as an auth file written from an env var by an
  `sh -c` wrapper so they never appear in argv, and reads the digest off stdout.
  `pullFromMirror` pulls the loopback ref and tags it with the upstream name.
  `scanImage` runs `aquasec/trivy` (pinned tag) with the `homerun-trivy-cache`
  volume on `/root/.cache`, JSON output parsed by `$lib/image-scan.ts`'s
  `summarizeTrivyReport`; for `docker`/`any` sources it binds the daemon socket,
  resolving the **host** path from this app's own container mounts when it runs
  in one (`config.docker.socketPath` is the in-container path). Every argv/ref
  builder is pure in `docker/image-scan-refs.ts`, tested in
  `tests/unit/app/image-scan.test.ts`. **Real, tested findings**: Docker accepts
  a loopback registry as insecure with no daemon config (verified on OrbStack);
  skopeo copies only the host platform's manifest, so the recorded digest is the
  platform manifest digest, not the upstream index digest;
  `--digestfile /dev/stdout` works and `--quiet` keeps progress off stdout.
- Mirror GC: `ImageMirrorGcService` (`$lib/services/image-mirror-gc.service.ts`)
  runs as the `pruneMirror` Docker Cleanup action (exclusive `docker_cleanup`
  job, button + size panel on `/docker-cleanup` via `getMirrorUsage`), queued
  daily at 04:00 by `cron/mirror-gc-scheduler.ts` under the first admin's id
  (postponed while deploy/image_scan jobs are queued or running). Keep set is
  pure in `docker/mirror-registry.ts` (`mirrorKeepSet` + `planMirrorGc`, from
  `listMirrorReferences` in `$lib/dto/mirror-reference-dto.ts`): per service the
  current `image:tag`, the digest of every **retained revision**
  (`DeploymentDTO.listRetainedRevisions`, the newest `RETAINED_REVISIONS` (5)
  distinct images per service, `$lib/revisions.ts`), and the last
  `MIRROR_GC_SCANS_PER_SERVICE` (2) distinct mirror-scan digests.
  `MirrorRegistryClient` there does catalog (Link paging) → tags → HEAD with an
  index/list-aware Accept → DELETE by digest, fetch injected so
  `tests/unit/app/image-mirror-gc.test.ts` mocks it. The mixin reaches the API
  at `127.0.0.1:5055` or `homerun-mirror:5000` (first that answers `/v2/`,
  container name first when this app runs in one) and `docker exec`s `du`,
  `registry garbage-collect --delete-untagged`, `rm -rf` of emptied repo dirs.
  **Real, tested findings**: `--delete-untagged` sweeps every manifest with no
  tag, so a kept older digest must be re-tagged first (`homerun-keep-<digest>`,
  a GET + PUT of the same manifest bytes/content type) or the rollback copy
  vanishes; deleting a manifest by digest drops every tag pointing at it; the
  registry needs a restart after GC or its `blobdescriptor: inmemory` cache can
  claim deleted blobs still exist; a collected image re-copies fine after the
  restart. `ensureImageMirror` recreates a `homerun-mirror` lacking
  `REGISTRY_STORAGE_DELETE_ENABLED=true` (volume persists). An in-process flag
  (`ImageMirrorGcService.running`, on `globalThis`) makes `deployThroughMirror`
  fall back to a direct pull while GC runs; the handler also refuses to start
  while a deploy/image_scan job is running.

`src/lib/services/secrets.ts` (not under `docker/`, it's a generic AES-256-GCM
utility, not Docker-specific, also used by SMTP/OAuth/S3-backup secrets),
`encryptSecret`/`decryptSecret` for `registryPasswordEnc` and every other `*Enc`
column, key derived via `scryptSync` from `config.auth.secret`.

Containers attach to the shared `homerun` Docker network rather than publishing
host ports, true for the default `networkMode: "bridge"`; see Network mode below
for the `"host"` exception. **`createAndStartContainer` calls
`ensureSharedNetwork()` on every local bridge-mode deploy** rather than assuming
a one-time `docker network create`: compose creates it for a compose-run
instance and nothing does for a bare `bun run start`, and Docker Cleanup's
network prune removes it once the last container detaches. Its absence fails at
container **start**, not create ("network homerun not found"), which is why the
deploy looked like it had gotten further than it had.

**Compose files.** The actual service definitions live once in
`tools/compose/{base,app,agent}.compose.yaml` (Traefik + Postgres in `base`, the
app and Agent in the other two); each root-level file is a thin `extends:`
composition of those, so Traefik's flags or Postgres's image change in one
place:

- `compose.yaml`, **local dev**, Traefik + Postgres only. Deliberately no `app`
  service: dev runs the app directly on the host (`bun run dev`/`bun run start`)
  so its own logs aren't viewable in-app (see `system-logs/` above). This is
  what `docker compose up -d` brings up, and what the app assumes exists.
- `compose.dev.yaml`, the same plus `app` and `agent` built from this repo's own
  `Dockerfile` (`target: app`/`target: agent`), for exercising the containerized
  app locally.
- `compose.prod.yaml`, the operator-facing stack: the published
  `docker.io/orochibraru/homerun` image alongside Traefik and Postgres.
  Deliberately **self-contained**, no `extends:`, since someone who `curl`s just
  this one file down has no `tools/` directory; it's Option B in
  `docs/getting-started.md`, so a change here has to stay in step with that doc
  (`bun run e2e:multipass:release --only=docs` checks exactly that).

**The dashboard gets its own Traefik router, off one variable
(`DASHBOARD_DOMAIN`).** The app container used to carry no `traefik.*` labels at
all in any compose file, so Homerun itself was reachable on `:3000` and nowhere
else no matter how carefully `baseDomain` was configured, while every service it
deployed got a routed hostname. The labels live in
`tools/compose/app.compose.yaml`, `compose.prod.yaml` and the installer's
generated compose (`packages/installer/steps/full-stack.ts`), and the shape they
take is the result of testing three candidates against the real dev Traefik:

- `traefik.enable` set to an empty string (what `${DASHBOARD_DOMAIN:+true}`
  expands to when the variable is unset) is **not** silently ignored: Traefik
  logs `ERR Skip container ... decoding Docker labels: strconv.ParseBool` on
  every provider refresh, which the app's own System Logs page then shows. That
  label must be exactly `true` or `false`.
- Always-on with a placeholder hostname is worse: a router with a cert resolver
  and a host rule naming `localhost` makes Traefik call the **real** Let's
  Encrypt API and log
  `Unable to obtain ACME certificate ... Domain name needs at least one dot`, a
  rate-limited request for nothing.
- What works, verified live (no log output at all, and a real 200 served through
  Traefik): always `traefik.enable=true`, a host rule reading
  `${DASHBOARD_DOMAIN:-localhost}`, `tls=true`, and a cert resolver of
  `${DASHBOARD_DOMAIN:+${DASHBOARD_CERT_RESOLVER:-letsencrypt}}`. An **empty**
  cert resolver is quietly fine and falls back to Traefik's own self-signed
  cert, and nested interpolation like that is supported by Compose (checked with
  `docker compose config`, all three branches). So unset means "dashboard on
  `https://localhost` plus `:3000`, nothing logged", set means "real hostname,
  real certificate", from one variable.

The installer bakes the address it resolved (`--domain=` or the detected host)
in as the rule's default, and picks the cert resolver by whether that address is
a bare IP, since ACME can't issue for one.

The app itself _is_ containerized for production use (`Dockerfile`,
`docker-bake.hcl`, built/pushed by `.github/workflows/docker.yaml`; see Release
automation below). The installer's `--mode=full` generates its own separate
compose file on the target host (see `packages/installer/` below) rather than
reusing any of these.

## Swarm mode (`instance_settings.orchestrationMode`, `service.replicas`/`swarmServiceId`, `src/lib/services/docker/swarm.ts`)

Instance-wide, opt-in alternative to the single-container-per-service model
described above: `instanceSettings.orchestrationMode` (`"standalone"` default |
`"swarm"`, `/settings`) switches every **local** deploy from
`createAndStartContainer` to `DockerService.createAndStartSwarmService`
(`DockerSwarmMixin`, `docker/swarm.ts`, chained into the same `DockerService`
mixin merge as the other concerns, see the ordering note above), creating a real
Docker Swarm Service (`docker.createService`,
`Mode: {Replicated: {Replicas: n}}`) instead of a plain container.
`deploy.service.ts` branches on `orchestrationMode` right alongside its existing
`buildSource` branch.

- `service.replicas` (int, default 1, edited on the Compute tab, ignored in
  standalone mode) is the desired replica count.
- `service.swarmServiceId` is the swarm-mode equivalent of `containerId`;
  `containerId` stays null for a swarm-mode service, there's no single container
  to point it at, `DockerSwarmMixin.getRunningTaskContainerId` resolves one
  specific task's container on demand instead (used by the Terminal tab's exec).
- Mixin surface: `ensureSwarmNetwork` (idempotent overlay network, the
  swarm-mode counterpart to `networks.ts`'s per-stack bridge networks),
  `createAndStartSwarmService`, `removeSwarmService`, `scaleSwarmService`
  (stop/start map to scaling to 0 / back to the configured replica count, rather
  than a real container stop/start), `restartSwarmService` (bumps `ForceUpdate`
  to recreate every task), `inspectSwarmServiceStatus` (aggregates task states
  into the same `ContainerStatus` vocabulary standalone mode uses, so the
  Overview tab doesn't need a separate rendering path), `streamSwarmServiceLogs`
  (same `ReadableStream` shape as `containers.ts`'s `streamLogs`).
  `docker/reconcile.ts`'s `DockerReconcileMixin` checks `service.swarmServiceId`
  first and calls `inspectSwarmServiceStatus` when present, falling back to the
  standard container path otherwise. The v1 REST API's `start`/`stop`/`restart`
  routes (`src/routes/api/v1/services/`) branch the same way, swarm-mode
  services are controllable via the API, not just the dashboard.

**Prerequisites this app never automates** (same "don't touch infra without the
admin's own action" boundary as custom SSL's Traefik config): the host's Docker
daemon must already be swarm-active (`docker swarm init`, done once by the
admin), and the live Traefik container needs `--providers.docker.swarmMode=true`
added to its command, a one-time `tools/compose/base.compose.yaml` edit +
restart (or its equivalent in whichever compose file is actually running,
`compose.prod.yaml` is self-contained, see Compose files below).

**This app only ever talks to the local manager.** Extra capacity comes from a
node _joining this swarm_ as a worker, which Docker then schedules onto on its
own; it is never a `remote_host` row. That's exactly why Remote Hosts was cut
back to build servers (see Build servers above), a second standalone daemon and
a swarm worker are different things and this app only wires up the latter.
`packages/installer/swarm-join.sh` (a standalone bash script, not part of the
TypeScript installer's `StepRunner`, documented in
`packages/installer/README.md`) is the groundwork for this gap: it joins a
remote box to an existing swarm as a worker on its own rootless Docker daemon
and installs the Homerun Agent there via `systemd --user`, the same install
shape `packages/installer/steps/agent.ts` uses locally, hand-mirrored rather
than sharing the TS installer's dry-run machinery so the two scripts stay in
lockstep by inspection. Usage:
`curl -fsSL .../swarm-join.sh | sudo bash -s -- --token <SWMTKN-...> --manager <ip>:2377`
(token/manager address come from `docker swarm join-token worker` on the
manager). Once joined, the node is schedulable by the swarm itself, nothing in
this app has to register it. **Not verified against a real second host or a real
swarm**: syntax-checked (`bash -n`) and `shellcheck`-clean, and every individual
command mirrors a step already dry-run-verified in the main installer, but the
actual `docker swarm join` handshake and a real Homerun deploy onto that node
haven't been run end-to-end, same caveat `bootstrap.sh` itself carries.

## Network mode (`service.networkMode`, `service.portProtocol`, Networking tab)

Per-service, `"bridge"` (default) or `"host"`, configured in the Networking
tab's **Network** section, alongside `containerPort` and `portProtocol` (`"tcp"`
default | `"udp"` | `"both"`, which protocol(s) `ExposedPorts` declares the
container's port under). `"host"` shares the host's network namespace directly
(`HostConfig.NetworkMode: "host"` in `docker/containers.ts`), for apps that
specifically need real host-network access (mDNS/SSDP discovery, e.g. Home
Assistant), which bridge networking can't provide.

Host mode forces `dnsResolvable` off (both in the stored row, at save time, and
again defensively at deploy time in `createAndStartContainer`), there's no
container-specific IP/network for Traefik's docker provider to route to in host
mode, only the host's own interfaces, so Traefik labels are skipped entirely
regardless of what's stored. No stack-network join either (Docker containers in
host mode can't also join a user-defined network). A host-mode service is
reachable only directly on the host's own `containerPort`, exactly as if you'd
run it with `docker run --network host` yourself, this app doesn't publish or
map anything either way, matching the existing "no host port publishing by
design" stance for bridge mode too.

**Real, tested finding**: `HostConfig.NetworkMode: "host"` combined with a
`NetworkingConfig.EndpointsConfig` (the shared-network attach bridge mode uses)
does **not** fail at the Docker API level the way you might expect, verified
live against a real scratch container, Docker silently accepted both and the
container ended up attached to the named network instead of `"host"`
(`NetworkSettings.Networks` showed the bridge network, not `host`).
`createAndStartContainer` explicitly omits `NetworkingConfig` entirely when
`networkMode === "host"` specifically because of this, sending both is not a
hard error you'd catch in testing, it's a silent wrong-mode footgun. Also
verified live: with `NetworkingConfig` correctly omitted, the container comes up
with `NetworkSettings.Networks: { host: {...} }` and no IP address, as expected
for real host networking.

## Docker Cleanup (`src/lib/services/docker/cleanup.ts`, `(protected)/docker-cleanup/`)

Admin-only (nav item, Administration category, `adminOnly: true`), host-wide
Docker housekeeping, `docker system df`/`prune` exposed through the dashboard
instead of needing shell access to the host. Deliberately **not**
`homerun.managed=true`-scoped like the rest of `DockerService`, this is the one
mixin that intentionally looks at (and can delete) containers/images/
networks/volumes/build cache Homerun didn't create, that's the entire point of a
cleanup tool.

`docker-cleanup/+page.server.ts`'s `load` calls
`DockerService.getCleanupPreview()` (`docker.df()` + `listNetworks()`, filtered
to what's actually reclaimable, unused images, non-running containers,
unreferenced volumes, unused networks excluding the three Docker defaults and
whatever's still attached to a container, unused build cache entries) so the
page shows what a prune would remove before the admin commits to it. Six form
actions, each a thin call into one `DockerCleanupMixin` method
(`pruneContainers`/`pruneImages`/`pruneNetworks`/`pruneBuildCache`/
`pruneVolumes`/`pruneSystem`, `pruneSystem` running the first four in sequence
and returning one combined summary), every one independently re-checking
`locals.isAdmin` the same as `load` does. No confirmation-dialog/dry-run step in
the UI itself, the preview list is the only "are you sure" a prune action gets.

**Retained revisions are never pruned.** `pruneImages(all, keepImageIds)` and
`pruneSystem(keepImageIds)` take the image ids of every retained revision
(`RevisionService.retainedImageIds()`: `revisionImageRefs` per revision, the
recorded `imageId`, `image@digest`, and the unique `homerun-build-*` tag for a
git build, resolved through `DockerService.existingImageIds`), and the preview
hides them too. With a non-empty keep list the prune doesn't call Docker's
`POST /images/prune` (whose only filters are labels and age, and a pulled image
can't be labelled) but walks `docker.df()`'s unused images and removes each one
not kept, skipping any the daemon refuses. That matters for dangling-only prunes
as well: a pulled revision whose tag moved on is untagged, i.e. dangling, but
still exactly what a rollback by digest needs.

## Web terminal (`src/lib/services/docker/terminal.ts`)

Per-service "Terminal" tab, runs `/bin/sh` in the live container (rejects the
request if the service isn't `currentStatus: "running"`). No WebSocket, this app
has no custom server to hang a `ws` upgrade off (`vite dev` in dev, a plain
built server via `bun run start` in prod), so it's chunked HTTP instead:
`POST .../terminal/open` creates the session,
`GET .../terminal/[sessionId]/stream` is one long-lived streamed response for
output (same `ReadableStream` shape as `streamLogs`),
`POST .../terminal/[sessionId]/input` sends stdin a chunk at a time,
`POST .../terminal/[sessionId]/close` ends it early (a 15-minute-idle reaper
also runs regardless, `setInterval`, HMR-safe `globalThis` guard like the other
schedulers). Every route re-checks session ownership (`userId` match)
independently, `terminal.ts` only trusts the `containerId` it's given, it
doesn't do its own auth.

**Load-bearing implementation detail**: dockerode's normal
`exec.start({hijack:true})`, the standard way to get an interactive exec's
duplex stream, hangs forever under Bun. Confirmed with a minimal repro before
writing any route code: `container.exec()` (plain request/response, creates the
exec) resolves fine, but `.start()` with hijacking (an HTTP/1.1
`Connection: Upgrade` handshake handing back a raw socket) never resolves, Bun's
`node:http` compatibility layer doesn't complete that handshake the way Node's
does. The fix in `terminal.ts` is to do the _start_ step manually: open a raw
`Bun.connect()` Unix-socket connection to the Docker daemon, write the HTTP/1.1
Upgrade request by hand, and treat the socket as the raw duplex TTY stream once
the `101 UPGRADED` header block has been read past. Verified against a real
container end-to-end (real command in, real output back) before wiring it into
routes. If a future change touches this file, re-verify this still holds, it's a
Bun-runtime quirk, not a documented/guaranteed API contract, and could change
with a Bun upgrade.

Audit trail is session-level, not per-keystroke: open/close are logged via the
standard `Logger` pattern (service/container/session/user ids), individual
commands typed into the shell are not. That's a deliberate scope cut, not an
oversight, logging raw TTY bytes verbatim would be noisy and wouldn't cleanly
map to discrete commands anyway (arrow-key history, tab-completion, etc. all
flow through the same input channel).

## Orphaned stack networks (`findOrphanStackNetworks`, Docker Cleanup)

A stack's network is named from its id (`homerun-stack-<id>`) and removed when
the stack is, but a stack row that disappears any other way (a test run tearing
down the database, a half-failed create) leaves the network behind forever.
**Twenty-one of them exhausted Docker's default address pools on the dev box**,
which fails _every_ new network with "all predefined address pools have been
fully subnetted" : compose import, new stacks and three integration tests broke
at once, with the real cause nowhere in the error. `docker network prune`
doesn't help while anything is attached, and it's a sledgehammer otherwise (it
takes unrelated unused networks with it, including the shared one).

`DockerService.findOrphanStackNetworks(liveStackIds)` lists every
`homerun-stack-*` network whose id isn't in the set the caller passes
(`StackDTO.allIds()`, so the DB stays out of the docker layer), and
`reclaimOrphanStackNetworks` removes the ones nothing is attached to, reporting
the rest rather than tearing a network out from under running containers. It's a
`docker_cleanup` queue action (`reclaimStackNetworks`) like every other prune,
with its own button and an inline list of what's orphaned on the Docker Cleanup
page.

## Custom SSL certificates (`src/lib/services/docker/custom-ssl.ts`)

Per-service, only meaningful once `customDomain` is set (a domain outside this
instance's own base domain, so Traefik's automatic ACME resolver can't cover
it), cert/key PEM stored encrypted
(`service.customSslCertEnc`/`customSslKeyEnc`, same AES-256-GCM scheme as
`registryPasswordEnc`), edited on the Networking tab's SSL section.

`DockerService.syncCustomSslConfig(svc)` runs after every Networking save. It's
a **deliberate no-op unless `config.traefik.dynamicConfigDir` (env
`TRAEFIK_DYNAMIC_CONFIG_DIR`) is set**, this app never modifies the live Traefik
container's command/mounts itself (that's the same "don't touch infra without
the admin's own action" boundary as the build-server feature's Docker daemon
connections, just applied to Traefik instead). When it _is_ set, it decrypts the
cert/key and writes three files into that directory: `certs/<slug>.crt`,
`certs/<slug>.key`, and `<slug>-tls.yml` (a Traefik file-provider dynamic config
pointing at the other two), or removes all three if the cert's been cleared or
the domain's changed. **That directory is now wired by default**, so this is
only inert on an instance whose compose file predates it: every compose file in
this repo and the one the installer generates share a `traefik_dynamic` named
volume between the app (`/app/traefik-dynamic`, which is what the generated
`homerun.yaml` points `traefik.dynamicConfigDir` at) and Traefik
(`/etc/traefik/dynamic`), with `--providers.file.directory` and
`--providers.file.watch` on. It used to be commented out with the admin expected
to wire a bind mount themselves, which meant custom SSL did nothing on a default
install. Traefik's file provider picks up changes on its own (`watch=true`), no
restart needed per certificate.

## The dashboard's own route (`syncDashboardRouter`, `docker/dashboard.ts`)

The same file provider is what makes the **Dashboard URL a real setting rather
than a compose variable**. The router that publishes this app itself is a set of
Traefik labels on its own container (`DASHBOARD_DOMAIN`, see the installer), and
**container labels are read only at creation**, so an app that can't recreate
itself can never honour a Dashboard URL typed into `/settings` : the host 404'd
at Traefik with nothing explaining why, and the only fix was editing compose by
hand. `DockerService.syncDashboardRouter()` writes `homerun-dashboard.yml` into
the dynamic-config directory instead : a router for
`dashboardHostFrom(config.auth.origin)` pointing at this container's own name on
the shared network (`selfContainer()`, found via the hostname Docker sets to the
container id, falling back to its IP), on `config.traefik.entrypoint`. It runs
from `hooks.server.ts`'s `init()` and from `applyAndRebuild()`, so every
settings save re-publishes it, and the file provider's `watch` means the change
is live with no restart of anything.

Three deliberate skips: an origin carrying an **explicit port** (that instance
is reached directly on it, not through Traefik : the installer's IP-mode
default), a container **whose own labels already route that host** (writing a
second, competing router for it would be worse than doing nothing), and an
**IPv4 dashboard host**, which gets `tls: {}` rather than a cert resolver
because ACME can't issue for a bare IP. The matching `dashboard-router` setup
check (see `observability.md`) reports the case this can't fix itself: no
dynamic config directory and no labels either.

Verified live: the encrypted round-trip, the no-op path when the dir is unset,
and, with a real directory configured, the three files actually landing with
correct byte-for-byte content, plus correct removal on clear. **Not verified**:
Traefik itself picking up the config, since that requires the live container
change this app deliberately doesn't make.

## Build servers (`remote_host` table, `RemoteHostDTO`, `/remote-hosts`)

**A registered remote host is a build server, nothing else.** Placement is
Swarm's job (see Swarm mode below): capacity comes from joining a node to the
swarm, not from pointing a service at a second daemon. `service.remoteHostId`,
the Settings tab's "Deploy target" picker, `resolveTarget`, `connectionFor` and
every remote branch in `deploy.service.ts`/`service-lifecycle.service.ts`/
`docker/reconcile.ts` were removed (migration `drizzle/0022_shiny_shiva.sql`).
Deploys run on the local daemon, or as a swarm service on the local manager.
What survives is `service.buildServerRemoteHostId`: a git-mode service can build
its image somewhere other than where it runs, which matters because a swarm
manager shouldn't have to also be the box with the build cache and the CPU
budget.

Two connection kinds (`remote_host.kind`, chosen on the "new host" form's
connection-type toggle), both real build servers:

- `"docker"` (the original/default): name + `tcp://host:port` [+ optional TLS
  client cert] or `ssh://user@host`, a raw Docker Engine connection, built
  through dockerode's own `buildImage()`.
- `"agent"`: name + `agentUrl`/`agentTokenEnc`, a registered Homerun Agent (see
  below) instead, token-authenticated HTTP rather than exposing the daemon
  itself, built through its own `POST /v1/build`. The token is verified against
  the agent (`AgentClientService.verifyToken`, which hits the authenticated
  `/v1/stats`) before the row is saved.

`RemoteHostDTO.resolveBuildTarget(hostId, userId)` is the one place a host id
becomes a `RemoteExecutionTarget` (`{kind: "local"}` /
`{kind: "docker", connection}` / `{kind: "agent", connection}`);
`deploy.service.ts` branches on that `kind` to route the build through
`DockerService` or `AgentClientService`. `RemoteHostDTO.listBuildServers()` is
what the Source tab's build-server picker reads : every registered host
qualifies, there's no per-host opt-in flag. `services/docker/client.ts`'s
`getDocker(remote?: RemoteHostConnection)` (exposed as
`DockerService.getDocker`, see Docker integration below) caches one dockerode
client per host (keyed by remote host id, `"local"` for the default) in the same
HMR-safe `globalThis` pattern as the db singleton, for `"docker"` hosts.

**A build server always needs a cache registry.** The built image lands on the
build server's own daemon, which by definition isn't the daemon the service
deploys to, so the registry is the only way it gets across; `deploy.service.ts`
rejects the combination outright rather than deploying a tag that doesn't exist
locally. Where the `git clone` runs depends on the build target: a `"docker"`
host clones on this host (`git-build.ts`'s `mkdtemp` is local) and streams the
build context to the remote daemon, whereas an `"agent"` host clones on the
agent itself (`packages/agent/docker.ts` does its own `mkdtemp` + `git clone`).
A repo only reachable from one of the two machines therefore works with one kind
and not the other.
