# API & CLI

## REST API

`/api/v1/*` is a thin, typed JSON wrapper over the same DTO layer the dashboard
itself is built on: not a separate abstraction. Every route checks its own auth
independently (a cookie session, or `x-api-key`/`Authorization: Bearer <key>`
from your profile page), so the same handlers serve the dashboard's own requests
and external API-key clients alike.

- `GET/POST /api/v1/services`, `GET/PATCH/DELETE /api/v1/services/:id`: delete
  takes `?force=true` to drop Homerun's record even when the container or swarm
  service couldn't be removed, the API equivalent of the Settings tab's
  [**Delete anyway**](services.md#the-services-list)
- `POST /api/v1/services/:id/{deploy,start,stop,restart}`: `deploy` awaits the
  full pull-or-build → create → start pipeline and returns once it's done (no
  separate polling endpoint for API clients: that's dashboard-only, for its own
  progress UI)
- `GET /api/v1/services/:id/webhook`: the
  [push-to-deploy](services.md#deploy-on-push) payload URL and secret for that
  service, a 404 when Deploy on push isn't on
- `DELETE /api/v1/auth-token`: revokes the API key that authenticated the
  request, what `homerun logout` calls (see [Logging in](#logging-in) below)
- `GET/POST /api/v1/stacks`, `GET /api/v1/templates`
- `GET/POST /api/v1/services/:id/scans`,
  `GET /api/v1/services/:id/scans/latest`,
  `GET /api/v1/services/:id/scans/:scanId`: image scan results, see
  [Image scans](#image-scans) below
- `GET /api/v1/services/:id/revisions`,
  `POST /api/v1/services/:id/revisions/:revisionId/deploy`: revisions and
  rollback, see [Revisions](#revisions) below
- `GET /api/v1/jobs/:jobId`: the status of a queued job, such as a scan
- `GET /api/v1/system-stats`: host CPU/RAM/disk/GPU

The list `GET`s (`services`, `stacks`, `templates`, a service's `scans`) are
paginated: `?page=`, `?perPage=` (default 100, max 100), and `?q=` for a
case-insensitive search. The response body stays a plain JSON array, on purpose,
so an existing integration keeps working unchanged; the total row count and the
page/size you got back come in the `x-total-count`/`x-page`/`x-per-page`
response headers instead. Both the OpenAPI spec and the CLI (below) document
these the same way.

### Image scans

A service's [image scans](services.md#image-scanning) are readable over the API:

- `GET /api/v1/services/:id/scans` lists them newest first, without findings:
  `id`, `deploymentId` (null for an on-demand scan), `imageRef`, `digest`,
  `status` (`ok`, `failed`, `skipped`), `counts` per severity, `fixableCounts`
  (findings with a fixed version, `null` on older scans), `totalFindings`,
  `scannedAt`, and `error` for a scan that didn't produce findings.
- `GET /api/v1/services/:id/scans/latest` and
  `GET /api/v1/services/:id/scans/:scanId` return one scan with its `findings`
  (top 200, most severe first). `latest` is a 404 until the service has been
  scanned once.
- `POST /api/v1/services/:id/scans` queues a scan of the deployed image, the
  same as the Security tab's **Scan now**, and answers `202` with a `jobId`.
  It's a `400` for a service that was never deployed, and a `409` (with the
  in-flight `jobId`) when a scan of that service is already queued or running.
  Poll `GET /api/v1/jobs/:jobId` until its `status` is `succeeded`, `failed` or
  `cancelled`, then read `scans/latest`.

Only your own services' scans and jobs are visible; anything else is a 404.

### Revisions

- `GET /api/v1/services/:id/revisions` lists the last 50
  [revisions](services.md#revisions-and-rollback) newest first: `id`,
  `imageRef`, `imageDigest`, `imageId`, `buildSource`, `gitCommit`, `gitRef`,
  `health` (`watching`, `healthy`, `unhealthy`, `rolled_back`, or null for one
  recorded before health watching existed), `rollbackOfDeploymentId`, `status`,
  `createdAt`/`finishedAt`, plus three markers: `current` (running now),
  `previous` (the default rollback target) and `retained` (its image is kept on
  the host).
- `POST /api/v1/services/:id/revisions/:revisionId/deploy` redeploys that
  revision's image without building, pulling from upstream or scanning, and like
  `deploy` returns once it's done. Use `previous` as the `revisionId` for the
  default target. A `404` means no such revision for that service, a `400` that
  there's no previous revision with a different image.

`PATCH /api/v1/services/:id` also takes `autoRollback`, `requireStatusChecks`
and `requiredStatusChecks` (see
[Required status checks](services.md#required-status-checks)), plus
`healthcheckCommand`, `imageScanEnabled` and `uptimeEnabled` (turns the
service's [uptime probes](services.md#uptime) on or off).

## OpenAPI spec & Swagger UI

`GET /api/v1/openapi.json` is a real, generated OpenAPI 3.1 document:
public/unauthenticated (it describes shapes, not data; every route it documents
still enforces its own auth). Request bodies come straight from the zod schemas
that validate each request at runtime, so the spec can't silently drift from
what the API actually accepts.

The **API Docs** page in the dashboard (own nav item) renders that spec with a
self-hosted Swagger UI: no outbound internet needed to view it. "Try it out"
from that page makes its own unauthenticated `fetch` calls (it doesn't share
your dashboard session), so paste an API key there to actually exercise a
request.

## CLI

A typed CLI (`packages/cli/`) built on
[`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) against the spec above:
its types are generated straight from a running instance's real
`/api/v1/openapi.json`, so the client is checked against the actual API shape,
not a hand-maintained guess.

### Install

One command: it detects your arch, downloads the matching release binary, and
drops it at `/usr/local/bin/homerun` (Linux or macOS, no Bun or build step
needed):

```sh
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/cli/install.sh | bash
```

`homerun update` re-runs that from inside the binary, replacing itself with the
latest release. `homerun --version` tells you what you have.

### Logging in

```sh
homerun login --base-url https://your-instance.example.com
```

This is a **device-code flow**: the CLI prints a short user code and a URL, you
open that URL in a browser where you're already signed in to Homerun, approve
the request, and the CLI picks up an API key of its own. It's saved to
`~/.config/homerun/config.json` (mode `0600`) alongside the instance URL, so
every later command just works with no flags.

`homerun logout` revokes that API key on the server, then clears the local file
regardless of whether the server call succeeded (an unreachable instance or an
already-invalid key never blocks logging out locally). Approved CLI clients are
also listed under **Profile → Authorized Clients** in the dashboard, where you
can revoke one directly.

If you'd rather not use the device flow, generate an API key from your profile
page and pass it per call or by environment:

```sh
HOMERUN_BASE_URL=https://your-instance.example.com \
HOMERUN_API_KEY=<a key from your profile page> \
homerun services list
```

`--base-url` and `--api-key` are global flags that override both the saved login
and those env vars, for hopping between instances.

### Commands

Session management, run these once rather than per-task:

```bash
homerun login --base-url <url>   # device-code login, saves an API key
homerun logout                   # clear the saved login
homerun update                   # self-update to the latest release
homerun --version
```

The rest operate on your instance:

```bash
homerun services list [--json]
homerun services get <id>
homerun services deploy <id>
homerun services start <id>
homerun services stop <id>
homerun services restart <id>
homerun services delete <id> [--force]
homerun services webhook <id>
homerun services scans <id> [--json]
homerun services scans get <id> [scanId] [--json]
homerun services scan <id> [--wait] [--fail-on critical|high|medium|low] [--timeout <seconds>] [--json]
homerun services revisions <id> [--json]
homerun services rollback <id> [revisionId]
homerun stacks list [--json]
homerun templates list [--json]
```

No `create`/`update` yet (`homerun update` above is the CLI's own self-updater,
unrelated). `homerun services delete <id>` is the same danger-zone action as the
Settings tab's Delete button, and `--force` deletes Homerun's record even when
the container or swarm service couldn't be removed (the API's `?force=true`,
without it that case is a `409` and deletes nothing).
`homerun services webhook <id>` prints a service's push-to-deploy payload URL
and secret (a `404` when Deploy on push isn't turned on).

Every `list` command also accepts `--page`, `--per-page` (default 100, max 100)
and `--search <term>` for a large result set; if what's printed is only part of
the total, a footer line tells you so
(`Showing 10 of 60 (page 1 of 6). Use --page/--per-page for the rest.`) rather
than letting a truncated table look complete.

`homerun services deploy` returns when the deploy has actually finished, not
when it's been queued, so it's usable as a step in a script or CI job.

`homerun services scans <id>` lists a service's image scans (it takes the same
`--page`/`--per-page`/`--search` flags as a list), and
`homerun services scans get <id>` prints the latest scan's counts and findings
table, or a specific one given its id. `homerun services scan <id>` queues a
scan and prints the job id; with `--wait` it waits for the scan and prints the
result, and `--fail-on <level>` (implies `--wait`) exits non-zero when the scan
found anything at or above that severity, so a CI job can gate on it:

```bash
homerun services deploy "$SERVICE_ID"
homerun services scan "$SERVICE_ID" --fail-on high
```

A scan that fails to run, or a wait that outlasts `--timeout` (default 1800
seconds), also exits non-zero.

`homerun services revisions <id>` prints a service's revisions with the current
and previous one marked, and `homerun services rollback <id> [revisionId]`
redeploys a revision (the previous one when no id is given) and waits for it
like `deploy`.

### Working on the CLI itself

From the repo root: `bun install && bun run packages/cli/index.ts services list`
(`bun run scripts/build-packages.ts <amd64|arm64>` compiles it the same way CI
does). See [`packages/cli/README.md`](../packages/cli/README.md) for the full
reference, including how to regenerate the generated types after an API change.
