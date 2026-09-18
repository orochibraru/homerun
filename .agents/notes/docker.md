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
    collides on "name already in use"; the _previous_ containers for a service
    are found by their `homerun.service.id` label, not by name, since names are
    no longer stable across deploys. **Redeploys are health-gated** through
    `DockerContainerRolloutMixin` (`docker/container-rollout.ts`, chained
    between networks and containers): `beginContainerRollout` lists the previous
    containers and asks the pure `rolloutStrategy` (`docker/rollout.ts`, tested
    in `tests/unit/app/rollout.test.ts`) for blue-green or recreate. Recreate
    (nothing running, host networking, or any writable volume) removes them
    before creating. Blue-green starts the new container alongside, polls
    `readinessVerdict` every 2s (healthy healthcheck, or running 5s with none;
    failed on exit, any restart, disappearance, `unhealthy`, or not ready in 5
    minutes), then removes the old ones in `completeContainerRollout`. On
    failure it logs the new container's last 20 lines, removes it and throws
    `RolloutFailedError`, which `#recordFailure` treats like a scan block
    (`syncServiceStatus`, service not marked failed). What keeps traffic off the
    new container until it's ready is its Docker healthcheck, picked by
    `planReadiness`, see "Readiness gate" below. The shared-network slug alias
    resolves to both copies during the overlap, health or not.
    `containerSampleFromInspect` is shared with
    `DockerRevisionMixin.containerHealthSample`. The container is aliased as its
    slug on the shared network (`NetworkingConfig.EndpointsConfig`) so other
    services can reach it at `http://<slug>:<containerPort>` regardless of the
    randomized name; if `params.stackId` is set, it also joins that stack's
    network under the same alias (`this.connectToStackNetwork`, inherited from
    the network mixin). `params.volumes` (from
    `ServiceVolumeDTO.listForService`) becomes `HostConfig.Binds`
    (`"source:containerPath[:ro]"`, covers both bind-mounts and named volumes
    with the same syntax). Don't call this directly from a new route, go through
    `$lib/services/deploy.service.ts`'s `DeploymentService.deployService()`
    instead (see above), which wraps it with deployment-row bookkeeping. →
    `DockerService.createAndStartContainer`.
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
    `internal/dockerapi`'s `ErrNotFound` (mapped to a real HTTP 404 by
    `cmd/agent/server.go`'s `saveImage`) make the same distinction for an
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
  deliberate narrow exception to the managed-label-only rule: lookup of the
  Traefik container by image-name prefix, which System Logs uses to put
  Restart/Update on Traefik's row of the stack list (its logs stream through the
  same per-container route as every other stack container). →
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
  **Rootless Docker**: `isRootlessDocker()` (`docker info` security options,
  pure `isRootlessDaemon`) skips the loopback pull, whose daemon lives in
  RootlessKit's network namespace and can't reach `127.0.0.1:5055`.
  `loadFromMirror` then runs skopeo on the shared network
  (`skopeoArchiveCommand`:
  `copy --src-tls-verify=false docker://homerun-mirror:5000/... docker-archive:/dev/stdout:<image:tag>`),
  demuxes the attached stdout straight into `docker.loadImage` (no buffering),
  and kills skopeo if the load fails. `ImageScanService`'s `#fetchFromMirror`
  order: loopback pull (rootful only) → mirror load → upstream pull. A loaded
  image has no `RepoDigests`, so the recorded digest is the mirror copy's. Not
  verified live on a rootless host.
- Mirror GC: `ImageMirrorGcService` (`$lib/services/image-mirror-gc.service.ts`)
  runs as the `pruneMirror` Docker Cleanup action (exclusive `docker_cleanup`
  job, button + size panel on `/docker-cleanup` via `getMirrorUsage`), queued
  daily at 04:00 by `cron/mirror-gc-scheduler.ts` under the first admin's id
  (postponed while deploy/image_scan jobs are queued or running). Keep set is
  pure in `docker/mirror-registry.ts` (`mirrorKeepSet` + `planMirrorGc`, from
  `listMirrorReferences` in `$lib/dto/mirror-reference-dto.ts`): per service the
  current `image:tag`, the digest of every **retained revision**
  (`DeploymentDTO.listRetainedRevisions`, the newest
  `instance_settings.retainedImagesPerService` (null = `RETAINED_REVISIONS`, 5;
  1 to 50 on Settings → Docker) distinct images per service,
  `$lib/revisions.ts`), and the last `MIRROR_GC_SCANS_PER_SERVICE` (2) distinct
  mirror-scan digests. `MirrorRegistryClient` there does catalog (Link paging) →
  tags → HEAD with an index/list-aware Accept → DELETE by digest, fetch injected
  so `tests/unit/app/image-mirror-gc.test.ts` mocks it. The mixin reaches the
  API at `127.0.0.1:5055` or `homerun-mirror:5000` (first that answers `/v2/`,
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
- Registry (`/registry`, admin-only, sidebar under Administration): turns
  `homerun-mirror` into a real push/pull registry rather than just a scan cache.
  `RegistryService` (`$lib/services/registry.service.ts`) owns
  `status()`/`authEnabled()`/`internalCredentials()`/`createToken()`/
  `revokeToken()`/`setAuthEnabled()`/`setPublicHost()`/`syncAuth()`/`catalog()`/
  `deleteTag()`/`deleteRepository()`. Tokens are `registry_token` rows
  (`RegistryTokenDTO`, `$lib/dto/registry-token-dto.ts`): `username` plus a
  bcrypt `secretHash` (`Bun.password.hash`, cost 10), the plaintext returned
  only once from `createToken`. `syncAuth()` rewrites the htpasswd file
  (`writeRegistryHtpasswd`, a one-off `alpine` container writing into the
  `homerun-registry-auth` volume, since the app can't reach into another
  container's volume directly) from every token plus a reserved
  `homerun-internal` token (`REGISTRY_INTERNAL_USERNAME`, minted the moment auth
  turns on and stored as `instance_settings.registryInternalSecretEnc`, same
  AES-256-GCM scheme as `registryPasswordEnc`), then calls `reconcileRegistry`,
  which diffs the container's env/labels against a `RegistryDesiredState`
  (`docker/registry-container.ts`'s pure
  `registryEnv`/`registryLabels`/`registryMatches`) and only recreates the
  container, never the `homerun-mirror-data` volume, when they've actually
  changed. `instance_settings.registryAuthEnabled`/`registryPublicHost` back the
  Settings tab's toggle and Traefik hostname (router `homerun-registry`, no
  buffering middleware since `docker push` streams whole layers);
  `setAuthEnabled`/`setPublicHost` enforce the safety rule both ways, in the
  service and not just the UI: auth can't turn off while `registryPublicHost` is
  set, and a host can't be set while auth is off, so a registry reachable from
  the internet always requires a token. Once auth is on,
  `DockerImageScanMixin.registryInternalAuth()` (reads the same secret) is
  threaded through every internal caller so none of them changed shape:
  `copyToMirror`'s skopeo auth file gets a second entry via the renamed
  `registryAuthFileFor` (now a list, `skopeoCopyCommand` gained a `destAuth`
  flag), `pullFromMirror`'s daemon pull passes an authconfig, and `scanImage`
  swaps in the same credentials whenever `params.ref` is `isMirrorRef`. The
  Images tab's delete/garbage-collect actions go through the same
  `MirrorRegistryClient`/`ImageMirrorGcService` as Docker Cleanup's "prune
  mirror" above, same keep-set rules; a registry delete is by manifest digest,
  so deleting one tag drops every other tag pointing at the same digest.
  **Verified live**: a real `registry:2` with a Bun bcrypt htpasswd rejected an
  anonymous request and a wrong password (401 both), accepted the right token,
  and a real `docker login`/`docker push` landed in `/v2/_catalog`. **Not
  verified**: a push through a published Traefik hostname with a real
  certificate. Tests: `tests/unit/app/registry-container.test.ts`,
  `tests/unit/app/registry-auth-file.test.ts`, `tests/e2e/ui-registry.spec.ts`.

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
generated compose (`cmd/installer/fullstack.go`), and the shape they take is the
result of testing three candidates against the real dev Traefik:

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
compose file on the target host (see `cmd/installer/` below) rather than reusing
any of these.

## Swarm mode (`instance_settings.orchestrationMode`, `service.replicas`/`swarmServiceId`, `src/lib/services/docker/swarm.ts`)

Instance-wide alternative to the single-container-per-service model described
above, and the default on an installer-made instance:
`instanceSettings.orchestrationMode` (`"standalone"` | `"swarm"`, null reads as
standalone, `/settings`) switches every **local** deploy from
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

**Default mode and how it's picked.** The installer's `--mode=full` now runs the
stack on the system daemon,
`docker swarm init --advertise-addr <default-route ip>`, creates `homerun`
(bridge) and `homerun-swarm` (attachable overlay), and writes Traefik's compose
command ending in exactly the three flags `enableSwarmMode` applies, in the same
key order, because `applyTraefikFlags` compares the whole argv and would
otherwise recreate Traefik on every boot. Nothing is seeded into the database:
`InstanceSettingsDTO.getOrCreate()` reports whether this boot created the
singleton row, and `OrchestrationService.applyOnBoot`
(`$lib/services/orchestration.service.ts`, called from `hooks.server.ts`'s
`init()`) stores `detectInitialOrchestrationMode()` on a fresh row only (pure
`initialOrchestrationMode`: swarm on an active manager with control available
that isn't rootless, standalone otherwise). An existing row is never flipped.
`--docker=rootless` keeps the old rootless install, which boots standalone.

**The host is prepared by the app, not by hand.** Saving Swarm on Settings →
Docker calls `DockerService.enableSwarmMode()` (see `core-services.ts` above):
`swarmInit` when the daemon isn't a manager, the `<networkName>-swarm` overlay,
Traefik attached to it, and Traefik v3's `--providers.swarm` flags written onto
the live container via `applyTraefikFlags`. `hooks.server.ts`'s `init()` calls
it again (fire and forget) whenever the stored mode is `swarm`, since a
`docker compose up` recreating Traefik from the compose file drops flags the app
added; `applyTraefikFlags` no-ops when they already hold, so a normal boot never
bounces the proxy. The action persists the mode **only after** host preparation
succeeded (it used to save first and report "Mode saved, but the host couldn't
be prepared", leaving a rootless instance stored as swarm with every deploy
failing), and the page's `load` asks `swarmModeUnavailableReason()` so a
rootless daemon shows the reason and a disabled Swarm option before submit. Not
handled by the app: a multi-interface host where `swarmInit` can't pick an
advertise address (the installer passes one; by hand, run
`docker swarm init --advertise-addr <ip>` once and save again).

**Migrating a rootless install** (`--migrate-to-rootful`,
`cmd/installer/migrate.go`'s `Migrate`): stops every container on the rootless
daemon, copies each named volume through `tar --numeric-owner` in `alpine:3` on
both daemons (ownership as the container saw it, not the subuid on disk),
recreates volumes with their labels so compose keeps owning them, sets up
swarm + networks, rewrites `homerun.yaml`'s `socketPath` and the compose file,
starts the stack, then waits for the app (so its migrations have run) and sets
`orchestration_mode = 'swarm'` plus `instance_settings.pendingServiceRedeploy`
in psql and restarts the app. `applyOnBoot` sees the flag, queues
`DeploymentService.enqueueDeploy` for every service with a `containerId` or
`swarmServiceId` under the first admin, and clears it. Progress markers live in
`<compose dir>/.rootful-migration`, so a re-run skips finished copies and never
queues the redeploys twice. Verified end to end on a Multipass VM from a real
v1.0.26 rootless install, see `cmd/installer/README.md`.

**Swarm spec details, and what swarm mode can't do.** Pure helpers in
`swarm.ts`, tested in `tests/unit/app/swarm-spec.test.ts`: `swarmMount` (an
absolute source is a bind mount, anything else `Type: "volume"`; every mount
used to be `bind`, so a service with a named volume couldn't deploy in swarm
mode at all), `swarmNetworksFor` (the overlay with the slug as an alias, so
`http://<slug>:<port>` works like in standalone, or `Target: "host"` for host
networking, which the deploy plan used to reject), `swarmRestartCondition`
(`on-failure` now maps to swarm's `on-failure`). `getRunningTaskContainerId`
only returns a task on this node (`info.Swarm.NodeID`), since exec and
pre-backup commands only reach the local daemon. The uptime probe runs its
hostname probe for swarm services (the network probe needs a container id). A
deploy log warns, once the swarm has a second node, that a `homerun-build-*`
image without a registry and any volume are per node. Still not supported:
privileged and devices (no swarm API), per-stack networks (everything shares the
overlay), terminal/stats/pre-backup on remote replicas. The Settings → Docker
page lists these.

**Per-replica stats.** `DockerSwarmMixin.listSwarmReplicas(swarmServiceId)`
lists the service's tasks (slot, node hostname, state, container id) and samples
each local task container with `sampleContainerStats`; a task on another node
comes back with `local: false` and no sample, since the app only reaches this
daemon. The service Overview renders it through `getReplicaStats`
(`stats.remote.ts`, polled) in `$lib/components/replica-stats.svelte`, and
`StatsSampler` records the sum over local replicas (`sumReplicaSamples`,
unit-tested in `tests/unit/app/swarm-replicas.test.ts`) as the service's
`stat_sample` (`ServiceDTO.listRunningWithContainers()` now also returns running
rows with a `swarmServiceId`; the uptime probe filters those back out), so the
usage graph works in swarm mode instead of staying empty.

**This app only ever talks to the local manager.** Extra capacity comes from a
node _joining this swarm_ as a worker, which Docker then schedules onto on its
own; it is never a `remote_host` row. That's exactly why Remote Hosts was cut
back to build servers (see Build servers above), a second standalone daemon and
a swarm worker are different things and this app only wires up the latter.
`cmd/installer/swarm-join.sh` (a standalone bash script, documented in
`cmd/installer/README.md`) joins a box as a worker **on its system (rootful)
daemon** and then runs the released installer binary with `--mode=agent` for the
agent, rather than hand-copying the TS installer's rootless steps (the copy had
drifted and lacked the AppArmor profile). Usage:
`curl -fsSL .../swarm-join.sh | sudo bash -s -- --token=<SWMTKN-...> --manager=<ip>:2377`.
Once joined, the node is schedulable by the swarm itself, nothing in this app
has to register it.

**Real, tested finding: swarm mode can't run on rootless Docker.** On a rootless
install (the installer's default at the time), saving Swarm initialised the
swarm and created the overlay, then `connect` for Traefik failed with "attaching
to network failed ... context deadline exceeded" and the daemon logged the task
failing with `mkdir /var/lib/docker/network: permission denied` (plus a missing
`br_netfilter` for the ingress network). Docker documents overlay networks as
unsupported in rootless mode. So `enableSwarmMode` calls
`assertSwarmCapableDaemon` first, which throws before touching the host when
`docker info`'s `SecurityOptions` carry `name=rootless` (`isRootlessDaemon`,
unit-tested in `tests/unit/app/swarm-rootless.test.ts`), and the installer
became rootful by default. Verified end to end on two Multipass VMs: rootful
manager, worker joined through the script, a 3-replica service with tasks on
both nodes, Traefik answering from every replica over the overlay
(`bun run e2e:multipass --swarm` replays it). Traefik's swarm provider polls
every `providers.swarm.refreshSeconds`, set to 2 (`SWARM_REFRESH_SECONDS`) by
`enableSwarmMode` and the installer, so new replicas join within 2s.

## Readiness gate (`docker/readiness.ts`, `planReadiness` in `docker/container-rollout.ts`)

A new container or swarm task gets no Traefik traffic before it's ready, like a
Kubernetes readiness probe, and the only lever that provably does that for both
providers is a **Docker healthcheck**. Verified facts, from source and live:

- **Traefik docker provider**: `keepContainer` (`pkg/provider/docker/config.go`
  in traefik/traefik, v3.7) drops a container whose `State.Status` isn't
  `running`, and one whose `State.Health.Status` is set and isn't `healthy`
  (unless `providers.docker.allowEmptyServices`). No healthcheck means `Health`
  is empty and a running container is routed at once. The provider rebuilds only
  on container events `start`, `die` and `health_status*`
  (`pkg/provider/docker/pdocker.go`), no polling, so network `connect` or
  `disconnect` is never noticed on its own. Live, behind a throwaway Traefik
  v3.7.13: a slow-starting second container with no healthcheck took 50% of
  requests as 502 for its whole startup; with a healthcheck (an image-style
  `wget` one, and the generated one below) every request went to the old
  container until the new one turned healthy, then both, zero errors.
- **Traefik swarm provider**: lists tasks with `desired-state=running` and keeps
  only `Status.State == running` (`listTasks` in
  `pkg/provider/docker/pswarm.go`), polling every
  `providers.swarm.refreshSeconds` (15s default), no events.
- **Swarm**: the executor's `Start`
  (`daemon/cluster/executor/container/controller.go` in moby/moby) returns, and
  the task becomes `running`, right after the container starts when there's no
  healthcheck; with one, only on the `health_status: healthy` event, and it
  activates the service binding (VIP and DNS) only then; an `unhealthy` event
  shuts the task down. Start-first (`manager/orchestrator/update/updater.go` in
  moby/swarmkit) removes the old task as soon as the new one reaches `running`.
  Live on a throwaway swarm: without a healthcheck an update to a task needing
  8s to listen gave about 6s of 100% 502 (old task stopped, Traefik then only
  knew the not-yet-listening one); with the generated healthcheck, zero errors
  from the gate itself. What's left is the poll lag: an old task that exits
  right away on SIGTERM gave about 4s of errors before Traefik's next poll
  dropped it. `traefik.docker.lbswarm=true` (VIP, which swarm updates instantly)
  would close that, but VIP routing didn't work at all on the OrbStack test
  daemon, so it's unverified and not used. Instead the poll is 2s
  (`SWARM_REFRESH_SECONDS`) and every router gets a `<slug>-retry` middleware
  (`labels.ts`, 4 attempts from 100ms): Traefik's retry
  (`pkg/middlewares/retry`) only retries a network error when no request bytes
  reached the backend, and never after response headers or on an upgrade, so a
  request dialing a removed container or task is replayed on the next server and
  a POST is never sent twice. It covers standalone's old container being removed
  while Traefik still lists it too. Not re-measured live.
- **Rejected alternatives**: starting the container off the Traefik network and
  connecting it after a probe (Traefik never sees the `connect`, and when the
  labelled network is missing it falls back to the container's first network
  address, routing to something it can't reach); Traefik's own load balancer
  healthcheck (a new server starts as up, and a path check fails on login-walled
  or 404-at-root apps); file-provider config (the routers come from labels).

`readinessCheck` picks, in order: the service's `healthcheckCommand`; nothing
when the workload isn't routed by Traefik (`dnsResolvable` false, host
networking, remote host); the image's own `HEALTHCHECK`; nothing for a UDP-only
port; nothing when the image can't be inspected or has no `/bin/sh`; otherwise
the generated **listening** check (`listeningScript`): a `CMD-SHELL` loop over
`/proc/net/tcp` and `/proc/net/tcp6` using only shell builtins, passing once a
socket is in `LISTEN` (`0A`) on the container port on a non-loopback address. It
works without nc/curl/wget/bash, verified on busybox ash and Debian dash (a
loopback-only listener fails it, as it should: Traefik couldn't reach it
either). `/bin/sh` is detected by creating a never-started throwaway container
from the image (`homerun-readiness-<hex>`) and `infoArchive`-ing `/bin/sh`,
which follows `/bin -> usr/bin` and busybox symlinks; `scratch` images
(`traefik/whoami`, `hello-world`) come back without one. The generated check
starts probing every second (`StartInterval`, Engine API 1.44+) for a start
period as long as `ROLLOUT_WINDOW.maxWaitMs`, then every 30s with 3 retries, so
it's liveness too: a crash-restart resets health to `starting`, which takes the
container out of Traefik again until it listens (verified). The service
healthcheck spec (`dockerHealthcheck`) got the same 1s `StartInterval`, so a
rollout no longer waits 30s for its first probe. Containers and task specs with
the generated check carry `homerun.readiness=listening`, and `containerHealth`
returns null for them so the uptime probe keeps its own HTTP/TCP probe rather
than reporting the generated check as the image's.

The deploy log gets one `Readiness: ...` line from `readinessDescription` on
every deploy, standalone and swarm, and the blue-green completion line says
whether Traefik only now routes to the new container or already was. Known gaps:
`scratch`/distroless images without a `HEALTHCHECK` (no gate; the service's
healthcheck command can't help either, it's `CMD-SHELL`); stopping the old
standalone container still races Traefik's `die` handling, one request timed out
in the live run when a SIGTERM-ignoring old container was killed.

## Runtime options (`service.command`/`entrypoint`/`envFiles`/`labels`/`capAdd`/`devices`/`privileged`, Runtime tab)

Stored as jsonb argv lists / string lists / a label map plus a boolean;
`$lib/service-runtime.ts`'s `runtimeOptionsFrom` reads them off a row with
defaults, and `deploy.service.ts`'s `#startWorkload` passes them as `runtime` to
both workload paths. The pure mapping is `docker/runtime-options.ts`
(`runtimeArgv` → `Cmd`/`Entrypoint`, `runtimeHostConfig` → `CapAdd` with the
`CAP_` prefix, `Devices` from `host[:container[:perms]]`, `Privileged`), tested
in `tests/unit/app/docker-runtime-options.test.ts`. Swarm maps entrypoint to
`ContainerSpec.Command`, command to `Args`, capabilities to `CapabilityAdd`, and
logs that privileged/devices are ignored (the swarm API has neither). Custom
labels go through `mergeLabels`, Homerun's own labels winning on a key clash, on
the container and on both the swarm service and its task spec.

Env files are **host** paths, but the app runs in a container, so
`deploy/env-file-step.ts` reads each one with an `alpine:3` `runOneOff` that
binds `/` read-only at `/homerun-host` and `cat`s the path. Binding the file
itself would make Docker create a missing path as a directory on the host. An
unreadable file throws, failing the deploy. Only the local daemon: container
workloads never pass `remote` today.

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

**Mounted volumes are never pruned either.** `pruneVolumes(keepVolumeNames)` and
`getCleanupPreview(keepImageIds, keepVolumeNames)` take
`ServiceVolumeDTO.mountedVolumeNames()`, the source of every `kind: "volume"`
storage volume with at least one `service_volume` row. Docker's own `RefCount`
only sees containers, so a service whose container was removed (a stopped swarm
service scaled to 0, a failed deploy, a `pruneContainers` run first) left its
data volume looking unused and `docker volume prune --all` took it. With a
non-empty keep list the prune walks `docker.df()`'s unreferenced volumes
(`prunableVolumes`, unit-tested in `tests/unit/app/docker-cleanup.test.ts`) and
removes each one not kept, same shape as the image keep list above.

## Registry (`/registry`, admin-only, `src/routes/(protected)/registry/`)

Turns `homerun-mirror` (see the Registry bullet under Docker integration above)
into a real push/pull-able private registry. Admin-only (nav item,
Administration category), four tabs, one route each: bare `+page.svelte` =
Images (the default), `tokens/`, `credentials/`, `settings/`.
`+layout.server.ts` guards on `user.role !== "admin"` and loads
`RegistryService.status()` once for every tab; `+layout.svelte` owns the
`TabNav`.

- **Images**: `catalog()` (repository/tag/digest, plus which `ServiceDTO`s
  reference each repository, cross-referenced through
  `mirrorRepository(image, tag)`) and its delete-tag/delete-repository/
  garbage-collect form actions.
- **Tokens**: `listTokens()`/`createToken()`/`revokeToken()`, with a one-time
  `docker login` snippet shown on creation (`form.created`, never re-derivable,
  the plaintext secret isn't stored).
- **Credentials**: read-only, `BuildCacheRegistryDTO.list()` plus every
  `ServiceDTO` with its own `registryUsername` set, each linking to where it's
  actually edited (`/build-cache-registries` or the service's Source tab). No
  storage of its own.
- **Settings**: `status()`, `setAuthEnabled()`, `setPublicHost()`.

See the Registry bullet under Docker integration above for `RegistryService`,
the schema, and the container reconciliation this page drives.

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
volume between the app (`/app/traefik-dynamic`, which the app's container
environment sets as `TRAEFIK_DYNAMIC_CONFIG_DIR`, the env fallback `config.ts`
reads when the YAML file has no `traefik.dynamicConfigDir`, and which the
generated `homerun.yaml` also points at) and Traefik (`/etc/traefik/dynamic`),
with `--providers.file.directory` and `--providers.file.watch` on. Local dev
(`compose.yaml`, app on the host) bind-mounts `./traefik-dynamic` into Traefik
instead, and `.env.example` sets `TRAEFIK_DYNAMIC_CONFIG_DIR=./traefik-dynamic`
to match (the directory is committed with a `.gitkeep` so Docker doesn't create
it root-owned on Linux). It used to be commented out with the admin expected to
wire a bind mount themselves, which meant custom SSL did nothing on a default
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
  client cert] or `ssh://user@host`, a raw Docker Engine connection, built with
  BuildKit in a `docker:cli` helper container on that daemon (see Build methods
  in `services-and-templates.md`).
- `"agent"`: name + `agentUrl`/`agentTokenEnc`, a registered Homerun Agent (see
  below) instead, token-authenticated HTTP rather than exposing the daemon
  itself, built through its own `POST /v1/build`. The token is verified against
  the agent (`AgentClientService.verifyToken`, which hits the authenticated
  `/v1/stats`) before the row is saved.

`RemoteHostDTO.resolveBuildTarget(hostId)` is the one place a host id becomes a
`RemoteExecutionTarget` (`{kind: "local"}` / `{kind: "docker", connection}` /
`{kind: "agent", connection}`); `deploy.service.ts` branches on that `kind` to
route the build through `DockerService` or `AgentClientService`.
`RemoteHostDTO.listBuildServers()` is what the Source tab's build-server picker
reads : every registered host qualifies, there's no per-host opt-in flag.
`services/docker/client.ts`'s `getDocker(remote?: RemoteHostConnection)`
(exposed as `DockerService.getDocker`, see Docker integration below) caches one
dockerode client per host (keyed by remote host id, `"local"` for the default)
in the same HMR-safe `globalThis` pattern as the db singleton, for `"docker"`
hosts.

**A build server doesn't need a cache registry.** The built image lands on the
build server's own daemon, so it has to be brought across
(`deploy/build-transfer-step.ts`'s `transferBuiltImage`). With a registry
(`plan.registry` set), a `"docker"` host pushes and this host pulls the
published ref (an agent already pushed during `/v1/build`). Without one, the
image is streamed and keeps its local `homerun-build-<slug>:<tag>` name: a
`"docker"` host through `DockerImageTransferMixin.copyImageFromRemote`
(`docker/image-transfer.ts`, dockerode `getImage(ref).get()` piped into the
local `loadImage`), an agent through `AgentClientService.saveImage` (the agent's
authenticated `GET /v1/images/save?ref=`, `Readable.fromWeb` of the body) into
`loadImageArchive`. Scan targets then only include the local copy. Not verified
against a real remote daemon or agent. The `git clone` runs on the build server
for both kinds, in an `alpine/git` container into a volume on that daemon
(`git-build.ts` with `remote` set, or `cmd/agent/build.go`/`cmd/agent/git.go`),
so the repo has to be reachable from the build server.
