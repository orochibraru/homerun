# Homerun CLI

A small Go client for Homerun's REST API (`/api/v1`, see the main app's
`$lib/openapi/`). Go, not Bun, for one reason: `bun build --compile` embeds the
whole Bun runtime, so the old TypeScript CLI compiled to ~81MB per platform (a
hello-world compiles to the same size, and neither `strip` nor `--bytecode`
moves it), against ~6MB for this one. It shells out to nothing and depends on
nothing outside Go's standard library.

It isn't generated from the OpenAPI document: the commands that format output
declare a struct for the handful of fields they print, and everything else is
passed through as raw JSON, so a new field in an API response needs no CLI
change at all. `tests/integration/support/openapi-types.ts` is what still keeps
the _integration suite_ typed against the spec.

## Installing it

```bash
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/cmd/cli/install.sh | bash
```

`install.sh` (Linux or macOS) detects your OS and arch, downloads the matching
`homerun-cli-<arch>` release binary (`amd64`/`arm64` on Linux,
`darwin-amd64`/`darwin-arm64` on macOS, a GitHub release asset on this repo),
and installs it as `/usr/local/bin/homerun`, `sudo`'d automatically if that
directory isn't writable by your user. From there:

```bash
homerun login
```

Prompts for your instance URL, then walks you through a machine-to-machine
login: it prints a short code and a URL, you open that URL in any
already-signed-in browser tab and enter the code to approve, and the CLI picks
up a freshly issued API key once you do. No API key to copy/paste by hand. The
URL and key are saved to `~/.config/homerun/config.json` (mode `0600`) so you
don't need to log in again; `homerun logout` clears it.

```bash
homerun services list
```

`--base-url`/`--api-key` flags or the `HOMERUN_BASE_URL`/`HOMERUN_API_KEY` env
vars override the saved login for a single call, and take precedence over it.
They can go before or after the subcommand
(`homerun --base-url <url> services list` or
`homerun services list --base-url <url>`, both work). Running any command with
none of the three configured (no flags, no env vars, no saved login) prints "Not
logged in" and points you at `homerun login` instead of a raw error.

A read-only API key (created with **Access: Read-only** under Profile →
Authorized Clients, or any key belonging to a read-only account) works with
every read command and gets a `403` from anything that deploys, starts, stops,
restarts, deletes or scans.

`--version=vX.Y.Z` (on `install.sh`) pins a specific release instead of the
latest one.

`homerun --help` (or `-h`, or no arguments at all) prints the full usage for
every command.

To work on the CLI itself instead of just using it: it's `package main` in the
repo root's single Go module (`go.mod`), so there's nothing to install beyond Go
itself.

```bash
go run ./cmd/cli services list             # from source
go test ./cmd/cli/... ./internal/cli/... ./tests/unit/go/internal/cli/...   # its unit tests, part of `bun run test`
go vet ./cmd/cli/... ./internal/cli/... ./tests/unit/go/internal/cli/...    # part of `bun run check`
gofmt -w ./cmd/cli                         # CI fails on anything gofmt would rewrite
bun scripts/build-packages.ts amd64 darwin-arm64
                                                # any of amd64, arm64, darwin-amd64,
                                                # darwin-arm64, outputs dist/homerun-cli-<arch>
```

Every target cross-compiles exactly (`GOOS`/`GOARCH`), so one runner builds all
four, and the release version is stamped in at build time with
`-ldflags "-X main.version=..."` from the root `package.json`.

## Commands

```bash
homerun login [--base-url <url>]
homerun logout
homerun update [--channel stable|canary|nightly]
homerun --version
homerun services list [--json] [--page <n>] [--per-page <n>] [--search <term>]
homerun services get <id>
homerun services config <id>
homerun services deploy <id> [--tag <tag>]
homerun services start <id>
homerun services stop <id>
homerun services restart <id>
homerun services delete <id> [--force]
homerun services webhook <id>
homerun services scans <id> [--json] [--page <n>] [--per-page <n>] [--search <term>]
homerun services scans get <id> [scanId] [--json]
homerun services scan <id> [--wait] [--fail-on critical|high|medium|low] [--timeout <seconds>] [--json]
homerun services logs <id> [--tail <lines>] [--follow]
homerun services revisions <id> [--json]
homerun services rollback <id> [revisionId] [--restore-config]
homerun stacks list [--json] [--page <n>] [--per-page <n>] [--search <term>]
homerun instance status [--json]
homerun instance update [--wait=false] [--timeout <seconds>]
homerun instance channel stable|canary|nightly
homerun templates list [--json] [--page <n>] [--per-page <n>] [--search <term>]
```

`list` without `--json` prints a plain text table; every other command prints
the raw JSON response. Listings are paginated: `--per-page` defaults to 100 (its
maximum), `--page` selects a page, and `--search <term>` filters server-side.
When a listing is only part of the total, a trailing line says so
(`Showing 10 of 60 (page 1 of 6). Use --page/--per-page for the rest.`); nothing
is printed when everything fit on one page. There's no `create`/`update` for a
service yet (`homerun update` above is the CLI self-updater, unrelated),
straightforward to add the same way as the existing commands in
`internal/cli/commands.go`.

`homerun services delete <id>` calls `DELETE /services/{serviceId}`, the same
danger-zone action as the Settings tab's Delete button; `--force` adds
`?force=true`, which deletes Homerun's record even when the container or swarm
service itself couldn't be removed (without it, that case answers a 409 and
deletes nothing). `homerun services webhook <id>` calls
`GET /services/{serviceId}/webhook` and prints the push-to-deploy URL and secret
for that service (a 404 when neither Deploy on push nor pull request previews
are turned on).

`homerun services scans <id>` is an alias for `homerun services scans list <id>`
(`list` is the group's default subcommand): a table of the service's image
scans, newest first, with per-severity counts. `homerun services scans get <id>`
prints the latest scan (`GET /services/{serviceId}/scans/latest`), or the one
named by a second `scanId` argument, as a header plus a findings table; `--json`
prints the raw scan instead. `homerun services scan <id>` calls
`POST /services/{serviceId}/scans` and prints `{jobId, status}`. With `--wait`
it polls `GET /jobs/{jobId}` every 2s until the job finishes, then prints the
latest scan; a `409` (a scan already in flight) is followed rather than treated
as an error when waiting. `--fail-on <level>` implies `--wait` and exits 1 when
the scan's counts at or above that severity are non-zero (`FindingsAtOrAbove()`
in `internal/cli/commands.go`); a failed or cancelled job, or a wait past
`--timeout <seconds>` (default 1800), exits 1 too.

`homerun services logs <id>` calls `GET /services/{serviceId}/logs` and writes
the plain-text body to stdout as it arrives: the last 200 lines by default,
`--tail <lines>` adds `?tail=`, and `-f`/`--follow` adds `?follow=true`, which
keeps streaming until the connection ends or you interrupt it.

`homerun services revisions <id>` calls `GET /services/{serviceId}/revisions`
and prints a table of the service's revisions, one row per revision with
rollbacks folded into the revision they redeployed (id, first deployed, last
deployed, a `current`/`previous` marker, health, image, commit, digest, and the
reason an unhealthy revision was judged so), `--json` for the raw list.
`homerun services rollback <id> [revisionId]` calls
`POST /services/{serviceId}/revisions/{revisionId}/deploy` with `previous` when
no revision id is given, which deploys the default rollback target (the newest
older healthy revision with a different image), and prints the deploy result
once it's finished, same contract as `homerun services deploy`.
`--restore-config` adds `?restoreConfig=true`, which also restores the env vars,
resources and networking that revision ran with.

`homerun instance status` calls `GET /instance/update` and prints the running
version, the release channel, its latest release and whether an update can start
now (with the reason when it can't), `--json` for the raw body.
`homerun instance update` calls `POST /instance/update`, which starts the same
self-update as the dashboard's **Update now** and answers `202` with the target
version, or `409` with why it can't. It then follows the update, polling every
3s: it prints the update helper's output from `GET /instance/update/progress` as
it arrives, ignores failed requests while the container is recreated, and stops
once `GET /instance/update` reports the new version as `current`. It exits 1
when the helper fails or after `--timeout <seconds>` (default 600).
`--wait=false` returns as soon as the update has started.
`homerun instance channel stable|canary|nightly` calls
`PATCH /instance/update/channel`, the same setting as Settings → General →
Release channel. All three are admin-only. `homerun update` is unrelated: it
updates the CLI binary itself.

`homerun update` self-updates the installed binary in place: it checks the
newest release on `--channel` (`stable`, the default, reads `releases/latest`;
`canary` and `nightly` read the newest `v<version>-<channel>.<n>` prerelease),
updates only when that version is strictly newer, so a canary CLI running
`homerun update` stays put until stable overtakes it rather than downgrading,
downloads the `homerun-cli-<arch>` asset for your architecture (same one
`install.sh` installs), and replaces the running binary (`sudo`'d automatically
if the install directory isn't writable by your user, same as `install.sh`).
Release assets are gzipped, so it unpacks the download before replacing the
binary. Linux and macOS, same as installation itself. `homerun --version` (or
`-v`) just prints the current version, no network call.

## After a REST API change

```bash
bun run gen
```

From the repo root: rebuilds `openapi.json` from source
(`scripts/generate-openapi.ts`) and regenerates
`tests/integration/support/openapi-types.ts` from it, no running instance
needed. CI's "Codegen is current" step fails on a stale one. The CLI itself
needs a change only when a command's _printed_ fields move, since everything
else is passed through as raw JSON.
