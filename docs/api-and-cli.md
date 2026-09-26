# API & CLI

## REST API

`/api/v1/*` is a thin, typed JSON wrapper over the same DTO layer the dashboard
itself is built on: not a separate abstraction. Every route checks its own auth
independently (a cookie session, or `x-api-key`/`Authorization: Bearer <key>`
from your profile page), so the same handlers serve the dashboard's own requests
and external API-key clients alike.

An API key is created with **Full access** or **Read-only** access (see
[API keys](your-profile.md#api-keys)). A read-only key, or any request from a
[read-only account](users-and-roles.md), can call every `GET` endpoint; every
`POST`, `PATCH` and `DELETE` answers `403` with
`{"error": "This account or API key is read-only: ..."}`. The OpenAPI spec lists
that `403` on every write.

- `GET/POST /api/v1/services`, `GET/PATCH/DELETE /api/v1/services/:id`: delete
  takes `?force=true` to drop Homerun's record even when the container or swarm
  service couldn't be removed, the API equivalent of the Settings tab's
  [**Delete anyway**](services.md#the-services-list)
- `POST /api/v1/services/:id/{deploy,start,stop,restart}`: `deploy` awaits the
  full pull-or-build → create → start pipeline and returns once it's done (no
  separate polling endpoint for API clients: that's dashboard-only, for its own
  progress UI)
- `GET /api/v1/services/:id/logs`: the service's container or swarm service logs
  as plain text, the last `?tail=` lines (default 200, max 10000), or a live
  stream with `?follow=true`; a `400` for a service that was never deployed
- `GET /api/v1/services/:id/webhook`: the [push-to-deploy](deploy-on-push.md)
  payload URL and secret for that service, whether the branch is polled instead
  and which provider to reconnect when it refused the webhook, a 404 when
  neither Deploy on push nor pull request previews are on
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
- `GET /api/v1/services/:id/deployments?limit=10`: the latest deploy attempts,
  failed ones included, each with its error and progress log (up to 50)
- `GET /api/v1/jobs/:jobId`: the status of a queued job, such as a scan
- `GET /api/v1/system-stats`: host CPU/RAM/disk/GPU
- `GET/POST /api/v1/instance/update`: the running version, the latest release
  and whether an update can start, and starting one, see
  [Upgrading](upgrading.md#without-the-dashboard); admins only
- `GET /api/v1/instance/update/progress`: the update helper's state and output,
  to follow a running update; admins only

The list `GET`s (`services`, `stacks`, `templates`, a service's `scans`) are
paginated: `?page=`, `?perPage=` (default 100, max 100), and `?q=` for a
case-insensitive search. The response body stays a plain JSON array, on purpose,
so an existing integration keeps working unchanged; the total row count and the
page/size you got back come in the `x-total-count`/`x-page`/`x-per-page`
response headers instead. Both the OpenAPI spec and the CLI (below) document
these the same way.

### Image scans

A service's [image scans](image-scanning.md) are readable over the API:

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

Every account sees every service's scans and jobs; an unknown id is a 404.

### Revisions

- `GET /api/v1/services/:id/revisions` lists the
  [revisions](revisions-and-rollback.md) among the last 50 deploys that reached
  running, one entry per revision, newest first by when it was first deployed. A
  rollback doesn't add an entry, it updates the revision it redeployed. Fields:
  `id` (the revision's original deployment, what the deploy endpoint below
  takes), `imageRef`, `imageDigest`, `imageId`, `buildSource`, `gitCommit`,
  `gitRef`, `status`, `createdAt` (first deployed), `lastDeployedAt` (last went
  live), `latestDeploymentId` and `redeployCount`, `health` of its latest run
  (`watching` and `healthy` only on the current revision, `unhealthy` and
  `rolled_back` kept as history, otherwise null), `healthReason` (why it was
  judged unhealthy, such as the failing swarm tasks' error, otherwise null),
  plus three markers: `current` (running now), `previous` (the default rollback
  target) and `retained` (its image is kept on the host).
- `POST /api/v1/services/:id/revisions/:revisionId/deploy` redeploys that
  revision's image without building, pulling from upstream or scanning, and like
  `deploy` returns once it's done. Use `previous` as the `revisionId` for the
  default target, and add `?restoreConfig=true` to also restore the env vars,
  resources and networking that revision ran with. A `404` means no such
  revision for that service, a `400` that there's no previous revision with a
  different image.

`PATCH /api/v1/services/:id` also takes `autoRollback`, `requireStatusChecks`
and `requiredStatusChecks` (see [Required status checks](status-checks.md)),
plus `healthcheckCommand`, `imageScanEnabled` and `uptimeEnabled` (turns the
service's [uptime probes](observability.md#uptime) on or off).

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

## MCP server for AI agents

Homerun serves an [MCP](https://modelcontextprotocol.io) server at
`https://<your dashboard>/api/v1/mcp`, so an AI agent can diagnose and fix your
services for you. It only runs when the Dashboard URL is `https` (or plain HTTP
on `localhost`), since MCP clients refuse anything else; on any other address
the endpoint answers 404 saying so. The dashboard also has to be reachable from
wherever the agent runs.

Nothing can connect to it until you allow it: MCP clients can't register
themselves, an admin creates each one.

- **claude.ai** (and Claude Desktop, which uses the same connectors): on the
  **Authentication** page's **Sign in with Homerun** tab, click **Register
  app**, then **Claude connector**, then **Register app**. In Claude, open
  Settings → Connectors → Add custom connector, paste the MCP URL above, and
  under Advanced settings the client ID and secret Homerun just showed you.
  Claude sends you to Homerun's sign-in page, Homerun asks you to allow it, and
  from then on it acts as you.
- **Claude Code**, or anything headless: no OAuth client needed, pass an API key
  instead, created under Profile → Authorized Clients. A read-only key gives an
  agent that can diagnose but not change anything.

```bash
claude mcp add --transport http homerun \
  https://<your dashboard>/api/v1/mcp --header "x-api-key: <key>"
```

It reads: `list_services`, `get_service`, `get_service_config`, `service_logs`,
`list_deployments` (each deploy attempt's error and log), `list_revisions`,
`list_stacks`, `system_stats` and `instance_status`. It changes:
`update_service`, `deploy_service`, `restart_service`, `start_service`,
`stop_service` and `rollback_service`. Deleting a service is deliberately not a
tool. Every tool goes through the REST API with your own permissions, so a
read-only account or API key can diagnose but not change anything.

Secrets don't reach the agent, the rest stays readable:

- An env var whose name has a secret-looking part (`PASSWORD`, `SECRET`,
  `TOKEN`, `KEY`, `CREDENTIAL`, `PRIVATE`, `SALT`…), or one marked secret by
  hand (see [Marking a variable secret](env-vars.md#marking-a-variable-secret)),
  shows as `[redacted]` regardless of its name.
- Any other value is shown as is, except a URL's password
  (`postgres://app:[redacted]@db:5432/app`).
- A `--requirepass` or `--password` argument in a command is also redacted, in
  logs too.

`update_service` merges env changes into what's stored: send only the vars to
change, `null` deletes one. Anything sent back exactly as the agent read it,
redaction included, keeps its stored value, and a placeholder that matches
nothing stored is refused rather than written. A secret under a name that
doesn't look like one (`TMDB_API`) is caught only once you mark it secret on the
Env vars tab; an app that prints its own secrets in some other form still leaks
them in its logs. To disconnect Claude, revoke it under Profile → Authorized
Clients (it can't refresh its access any more, and the token it holds expires
within the hour), or delete its app under Authentication → Sign in with Homerun
to cut it off for everyone.

## CLI

A CLI (`cmd/cli/`) against the API above. It's a small, standalone Go binary
(around 6MB) with no runtime to install, rather than the old Bun build that
shipped a whole embedded runtime for the same job.

### Install

One command: it detects your arch, downloads the matching release binary, and
drops it at `/usr/local/bin/homerun` (Linux or macOS, no Bun or build step
needed):

```sh
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/cmd/cli/install.sh | bash
```

`homerun update` re-runs that from inside the binary, replacing itself with the
latest release; `homerun update --channel canary` (or `nightly`) follows those
builds instead (install one with `install.sh --version=canary` or
`--version=nightly`, which pick the newest build on that channel). It never
downgrades. `homerun --version` tells you what you have.

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
and those env vars, for hopping between instances. A read-only key works the
same way for every read command (`list`, `get`, `scans`, `revisions`, `webhook`)
and fails with a `403` on anything that changes state; `homerun logout` still
revokes it.

### Commands

Session management, run these once rather than per-task:

```bash
homerun login --base-url <url>   # device-code login, saves an API key
homerun logout                   # clear the saved login
homerun update [--channel canary|nightly] # self-update to the latest release (or canary/nightly build)
homerun --version
```

The rest operate on your instance:

```bash
homerun services list [--json]
homerun services get <id>
homerun services config <id>
homerun services deploy <id> [--tag <tag>]
homerun services start <id>
homerun services stop <id>
homerun services restart <id>
homerun services delete <id> [--force]
homerun services webhook <id>
homerun services scans <id> [--json]
homerun services scans get <id> [scanId] [--json]
homerun services scan <id> [--wait] [--fail-on critical|high|medium|low] [--timeout <seconds>] [--json]
homerun services logs <id> [--tail <lines>] [--follow]
homerun services revisions <id> [--json]
homerun services rollback <id> [revisionId] [--restore-config]
homerun stacks list [--json]
homerun templates list [--json]
homerun instance status [--json]
homerun instance update [--wait=false] [--timeout <seconds>]
homerun instance channel stable|canary|nightly
```

No `create`/`update` yet (`homerun update` above is the CLI's own self-updater,
unrelated). `homerun services delete <id>` is the same danger-zone action as the
Settings tab's Delete button, and `--force` deletes Homerun's record even when
the container or swarm service couldn't be removed (the API's `?force=true`,
without it that case is a `409` and deletes nothing).
`homerun services webhook <id>` prints a service's push-to-deploy payload URL
and secret (a `404` when neither Deploy on push nor pull request previews are
turned on).

Every `list` command also accepts `--page`, `--per-page` (default 100, max 100)
and `--search <term>` for a large result set; if what's printed is only part of
the total, a footer line tells you so
(`Showing 10 of 60 (page 1 of 6). Use --page/--per-page for the rest.`) rather
than letting a truncated table look complete.

`homerun services config <id>` (or `homerun services <id> config`) prints a
service's settings as JSON, grouped the way the dashboard's tabs are: `source`,
`env`, `volumes`, `networking`, `compute`, `runtime`, `security` and `settings`.
Secrets never appear: a stored registry password or SSL key shows as
`passwordSet`/`customSsl: true`, and an uploaded icon as `"uploaded"`. It's
`GET /api/v1/services/{id}/config` underneath, handy for diffing two services or
keeping a copy of one's setup:

```bash
homerun services config "$SERVICE_ID" > app-config.json
```

`homerun services deploy` returns when the deploy has actually finished, not
when it's been queued, so it's usable as a step in a script or CI job.
`--tag <tag>` first switches an image-based service to that image tag (and keeps
it), for a pipeline deploying the image it just pushed: see
[Deploying from CI](ci-cd.md).

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

`homerun services logs <id>` prints the last 200 lines of a service's logs
(`--tail <lines>` for more or fewer), and `--follow` keeps streaming until you
interrupt it.

`homerun services revisions <id>` prints a service's revisions with the current
and previous one marked and, for an unhealthy one, the reason, and
`homerun services rollback <id> [revisionId]` redeploys a revision (the previous
one when no id is given) and waits for it like `deploy`; `--restore-config` also
restores that revision's env vars, resources and networking.

### Working on the CLI itself

The CLI is a Go program, not part of the Bun app: from the repo root (with Go
installed), `go run ./cmd/cli services list` runs it from source, and
`bun run scripts/build-packages.ts <amd64|arm64|darwin-amd64|darwin-arm64>`
compiles it the same way CI does. See
[`cmd/cli/README.md`](../cmd/cli/README.md) for the full reference.
