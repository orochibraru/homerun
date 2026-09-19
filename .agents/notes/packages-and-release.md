# Agent, installer, release automation

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## The agent's git builds (`internal/agent/build.go`, `internal/agent/git.go`)

`Builder.Build`/`BuildWithProgress` is now the **single** implementation of
"clone a git repo into a container volume, then build it": the SvelteKit app has
none of its own anymore (`docker/git-build.ts` and `docker/builder-run.ts` were
deleted once the `deploy` job type moved to the Go worker, see `worker.md`). The
homerun worker's own local and Docker-build-server builds
(`internal/jobs/deploy/build.go`'s `dockerBuild`) call this exact same
`agent.NewBuilder(docker, socket).BuildWithProgress` against whichever daemon
they're building on; only a registered Homerun Agent build server calls it over
HTTP instead, through its own `POST /v1/build`
(`internal/jobs/deploy/build.go`'s `agentBuild`). **Including its
clone-in-a-container shape**: the agent image has no git binary of its own, so
cloning can't shell out directly. It pulls `alpine/git`, clones into a named
volume, tars the context back out, and removes the volume in a deferred cleanup.

**A private repo works too**: `BuildInput` (`POST /v1/build`'s body, and the
homerun worker's own in-process struct for the other two build kinds) carries an
optional `Credential` (`{username, token}`) that `deploy/helpers.ts`'s
`resolveGitCredential` fills, since the agent has no access to the git-provider
tables. `authenticatedCloneURL` and `redactCloneURL` (`internal/agent/git.go`)
are the only implementation left of what `$lib/git-clone-url.ts` used to also
carry (`authenticatedCloneUrl`/`redactCloneUrl`, deleted from the app once
nothing there called them anymore), and every log line and error message goes
through the redaction so a token can't reach the deployment log.

## Release automation (`.releaserc.json`, `scripts/bump-version.ts`, `scripts/build-packages.ts`)

**The CI pipeline builds each image once and reuses it.** Both
`pull_request.yaml` and `publish.yaml` run the same shape: `code_quality` →
`docker.yaml` (per image) → `e2e.yaml` → `docker-manifest.yaml` (per image) →
gate/release. `pull_request.yaml` additionally runs `screenshots.yaml` off
`code_quality`, in parallel with the image builds rather than after them,
because that one is the exception to "build the image once" : it must run the
app as a local process to reach the Docker socket (see Screenshots in
`testing.md`), so it does its own `bun run build:app` and never touches the
image under test. The split between the last two is the point : `docker.yaml`
pushes **by digest only** (`push-by-digest=true`, no tag), so `e2e.yaml` can
`docker pull` that exact digest and run Playwright against the real artefact,
and `docker-manifest.yaml` only then applies the friendly tag (`pr-<n>`,
`vX.Y.Z`, `latest`). Nothing anyone can pull by name is ever published before
e2e has passed against it, and the app is built once per platform instead of
once for the image plus again from source for the tests. The per-platform
digests and the `docker-metadata-action` bake file travel between those
workflows as run artefacts, which is why they must stay in one workflow run
(`uses:`, not a separate `workflow_run`). Both arches build natively
(`ubuntu-24.04-arm` for arm64), never under QEMU.

**A merge to `main` doesn't rebuild what the PR already tested.**
`publish.yaml`'s `resolve` job looks up the merged PR and promotes its `pr-<n>`
images straight to `vX.Y.Z` + `latest` (`promote`, a
`docker buildx imagetools create`, no build, no e2e, no `code_quality`) when
three things hold: the squash commit's tree matches the PR head's tree apart
from `CHANGELOG.md` and `package.json`'s `version` field (the ruleset doesn't
require up-to-date branches, so this is checked rather than assumed), `CI Gate`
passed on that head, and both `pr-<n>` tags exist. The release-bump exclusion is
load-bearing: every release pushes a `chore(release)` commit touching exactly
those two, so almost every PR is behind `main` by one, and a strict tree
comparison sent PR #17 down the rebuild path, where e2e re-ran against a fresh
image and failed on flake the PR had never hit, blocking the release. The app
image doesn't embed the version, so that diff can't change what ships. Anything
else (a direct push, a stale PR, a fork) falls back to the full build → e2e →
manifest chain. Binaries always rebuild, since the release version is baked into
them. The release job accepts either path. `pr-<n>` tags of a merged PR are
deleted by `publish.yaml`'s `cleanup` once the images are published, not by
`pr-cleanup.yaml` (which now only handles PRs closed unmerged), otherwise the
two would race on merge and delete the tag being promoted. Both call
`delete-pr-images.yaml`.

**Docs-only changes skip the expensive jobs.** `publish.yaml` has a
`paths-ignore` for `docs/**`, `**/*.md`, `.agents/**` and `.claude/**`, so a
docs push neither builds nor releases (its commits ship with the next code
push). `pull_request.yaml` can't do the same at the workflow level, since
`CI Gate` is the ruleset's required check and a workflow that never runs leaves
it pending forever: its `changes` job lists the PR's files against the same
patterns and, when nothing else changed, skips binaries, image builds, e2e,
screenshots and `code_quality`'s `ts-test` (its `tests` input). Lint still runs,
it covers markdown. Keep the two pattern lists in sync.

**PR titles must be conventional commits.** The repo squash-merges with the PR
title as the commit message, so the title is what `semantic-release` reads.
`pr-title.yaml` rejects a non-conventional title and leaves a notice saying
whether the type cuts a release (`feat`/`fix`/`perf`/`refactor`/`docs`, or a
`!`). A title like "Fix/bug batch" merged without releasing anything before this
existed.

**Every PR gets one comment, edited in place.** `pull_request.yaml`'s `summary`
job runs `if: always()` after everything else and upserts a single comment
carrying the check table (with Playwright's own pass/fail counts), the images
that were published and the tag they got, and a copy-pasteable
`HOMERUN_VERSION=pr-<n> docker compose -f compose.prod.yaml up -d` for trying
that exact build. It finds its previous comment by a hidden
`<!-- homerun-ci-summary -->` marker on the first line and PATCHes it, so a
force-push or a re-run edits one comment instead of adding another. The plumbing
behind the counts is worth knowing before touching it:

- **Reusable workflows only report one aggregate `result` to the caller**, so
  `code_quality.yaml` exposes its two jobs separately through `workflow_call`
  outputs. Those outputs can't be `${{ jobs.<id>.result }}` — actionlint (which
  `code_quality.yaml` itself runs via prek) rejects `result` on the `jobs`
  context there — so each job ends with a `Record result` step writing
  `job.status` to a step output, which the workflow output then reads.
- **The Playwright counts come from its JSON reporter**, enabled per-run rather
  than in the config: CI appends `--reporter=list,json` and sets
  `PLAYWRIGHT_JSON_OUTPUT_NAME`, then a `jq` step turns `.stats` into
  `"25 passed"` / `"23 passed, 2 failed"`. Reading the file in a separate step
  is what makes the counts survive a failing test run : the reporter step has
  `if: always()`, so a red job still comments its real numbers instead of
  nothing.
- **The job is gated on the PR not coming from a fork**, like the publish jobs :
  a fork's `GITHUB_TOKEN` is read-only and couldn't comment anyway. It carries
  its own `pull-requests: write` at job level rather than widening the
  workflow's default token, and it is deliberately **not** in the `gate` job's
  `needs` : a failed comment shouldn't block a merge.

Three consequences worth not re-deriving: **a fork builds but publishes
nothing** — `push: false` makes the build `type=cacheonly`, so no digest
artefact exists, which is why `e2e.yaml` takes a `pulled` input and falls back
to `bun run build:app`, and why every manifest job is gated on the PR not coming
from a fork. **`pr-cleanup.yaml`** deletes the `pr-<n>` tags when a PR closes
unmerged (see above for merged ones), so the Docker Hub repos don't accumulate
one per pull request; a 404 there is normal (e2e failed, so the tag was never
created). And **`code_quality.yaml` no longer runs e2e at all** — it is `lint` +
`docs-check` + `ts-test` only, with the heavy gates (`lint:ts`, `lint:tailwind`,
`check`, `test:unit`) skipped inside prek via `SKIP` and run as their own named
steps instead, so a red run names the gate that broke rather than burying it in
one `prek` log. Its `Codegen is current` step runs `bun run gen` and fails on
any resulting diff, which is what keeps `openapi.json`, `homerun.schema.json`
and `tests/integration/support/openapi-types.ts` from silently going stale after
a REST API change (the CLI itself has no generated types to go stale, see
Homerun CLI in `api-and-cli.md`).

`semantic-release`, driven by conventional-commit messages (this repo's commits
already follow `feat:`/`fix:`/`chore:`, no new discipline required). Runs as a
new `release` job in `.github/workflows/publish.yaml`, alongside the existing
`code_quality`/`build` jobs, on every push to `main`; a non-releasable push
(docs/chore-only) is a no-op, not a failure. One version number covers the whole
repo: the root `package.json` gets bumped by `scripts/bump-version.ts` (none of
the three `cmd/` Go programs carry a `package.json` of their own to bump, they
read the root one's version directly at build time, stamped in via `-ldflags`
into `internal/buildinfo.Version`, see `scripts/build-packages.ts` below), an
`@semantic-release/exec` `prepareCmd`, not `@semantic-release/npm`, this repo
has no npm package to publish, and `npm`'s plugin still wants registry-shaped
config even with `npmPublish: false`; a small script fits this codebase's
existing "hand-roll a small thing rather than fight a mismatched tool" posture
better, same instinct as the cron matcher/SigV4 client).
`scripts/build-packages.ts` builds every release binary: all three commands
(`cli`, `installer`, `agent`) are Go now, so every target cross-compiles from
any one machine (`go build` with `GOOS`/`GOARCH` set, exact, unlike Bun's own
cross-compilation — see Homerun CLI in `api-and-cli.md`): `cli` for all four
targets (`amd64`/`arm64`/`darwin-amd64`/`darwin-arm64`), `installer` and `agent`
for `amd64`/`arm64` Linux only, since both only ever run on the Linux host they
manage. Eight binaries total, so `.releaserc.json`'s release-assets step has
something to attach, directly serving the "installer (and homerun agent) in each
release artifact" TODO item, with the CLI's own binaries added the same way for
consistency.

**Uses `@semantic-release/github`**, the official plugin: this repo is hosted on
GitHub (`github.com/orochibraru/homerun`) and runs on GitHub Actions. It
previously lived on a self-hosted Gitea and used
`@saithodev/semantic-release-gitea`; that migration is done, so don't
reintroduce Gitea-specific release/CI config.

**The binaries aren't uploaded by `@semantic-release/github`.** It creates the
release as a draft (`draftRelease: true`), a second `@semantic-release/exec`
entry's `successCmd` writes the tag to `.release-tag`, and the release job's
next step runs `scripts/upload-release-assets.ts <tag>`: one
`gh release upload --clobber` per binary with retries, all ten concurrently,
skipping any already uploaded at the same size, then
`gh release edit --draft=false --latest`.

**Every binary is published gzipped, as `<name>.gz`.** The rationale predates
the agent's move to Go: back when it was the one `bun build --compile` binary,
it was ~62-82MB of which ~62MB was the embedded Bun runtime (a hello-world
compiled to the same size), so ten of them was ~800MB per release and the
sequential upload step ran 40+ minutes. Every binary is Go now and none embed a
language runtime, but the gzip step, the `.gz`-suffixed asset naming and every
downloader that unpacks one stayed, both for the smaller download and because
nothing forces re-deriving it: `install.sh`/`bootstrap.sh`/`swarm-join.sh` pipe
through `gunzip -c`, `internal/installer/release.go`'s `DownloadReleaseBinary`
curls `<name>.gz` and shells out to `gunzip -f` the same way, and `cmd/cli`'s
own `homerun update` (`downloadRelease`) unpacks in-process via
`internal/release.DownloadGzipped` (`compress/gzip`), the one place this repo
does it without shelling out. Releases up to v1.0.33 carry raw, un-suffixed
assets, so `scripts/e2e-multipass.ts`'s pinned `PREVIOUS_RELEASE` download stays
un-suffixed until that pin moves past v1.0.33. Real failure it replaced: the
plugin uploads all ten ~80MB binaries in one go with no retry, uploads took
minutes each, and a 504 from `uploads.github.com` on the tenth left v1.0.32 a
draft with the tag pushed and no way to resume. Since a draft isn't
`releases/latest`, `install.sh` and `homerun update` never see a release until
every binary is on it. A failed upload step is finished by hand: download the
run's `binaries-*` artifacts into `dist/` and run the script with that tag.

**Container images go to Docker Hub, not GHCR**, deliberately:
`docker.io/orochibraru/homerun{,-agent,-docs}`. That's the one piece of the
pipeline that does _not_ follow the code host, so `docker.yaml`'s login takes a
real Docker Hub credential (`secrets.DOCKER_REGISTRY_PASSWORD`, an access token;
the Docker Hub username is the plain `registry_username` input, since it isn't
secret) rather than the built-in `GITHUB_TOKEN`.

**The release job needs `secrets.RELEASE_TOKEN`, not `GITHUB_TOKEN`**: a
fine-grained PAT scoped to this repo (Contents + Issues + Pull requests: write).
`@semantic-release/git` pushes the version bump straight to `main`, and a `main`
ruleset blocks pushes from anyone but a repo admin, which `github-actions[bot]`
isn't. It's threaded in twice, as `actions/checkout`'s `token` (git push auth)
and as the `GH_TOKEN` env var (`@semantic-release/github`'s API calls). The
`version` job's dry run takes it too, in **both** places, unlike the sibling
`nuvio-web` repo this CI shape is shared with: here that job's output also feeds
the `binaries` job's and the app image's baked version, so it has to actually
resolve rather than silently falling back to a commit SHA. Real bug: that job
passed `RELEASE_TOKEN` only as `GH_TOKEN` while `actions/checkout` persisted the
read-only default token, so semantic-release's `git push --dry-run` check 403'd
(`EGITNOPERMISSION`), the step's `|| true` swallowed it, the version came back
empty, and v1.0.22 shipped reporting 1.0.21 with a permanent "update available"
notice. The checkout now takes `RELEASE_TOKEN` too, and a failing dry run fails
the job instead of falling back; only a successful run with no release-worthy
commits uses the SHA.

**A PR that can break the release dry-runs it.** `pull_request.yaml`'s `changes`
job also sets `release=true` when the PR touches `package.json`, `bun.lock` or
`.releaserc.json`, which is every Renovate bump of a `@semantic-release/*`
plugin, and `release-dry-run` then runs
`semantic-release --dry-run --no-ci --branches <head ref>` on a checkout of the
PR branch. Two things make that a real test rather than a no-op:
semantic-release returns "triggered by a pull request" before `verifyConditions`
on a PR event, so the step overrides `GITHUB_EVENT_NAME=push` and `GITHUB_REF`
to the head branch in the shell (env-ci reads those to detect a PR), and it only
releases from `main`, so `--branches` makes the PR branch the one release
branch. It then loads every plugin and runs `verifyConditions`, `analyzeCommits`
and `generateNotes` for real (checked locally: every plugin loads), with
`RELEASE_TOKEN` on both checkout and `GH_TOKEN` for the same
`git push --dry-run` reason as the `version` job above. Skipped on fork PRs (no
secrets), counted by `CI Gate`, and shown in the summary comment.

**Job ids use `-`, never `:`** (`build-app`, not `build:app`). GitHub rejects a
colon in a job id outright and refuses to run the whole workflow file; the
Gitea-era config had `build:app` and got away with it.

**Fork PRs build but never push.** `docker.yaml` takes a `push` input (default
true); `pull_request.yaml` passes
`github.event.pull_request.head.repo.full_name == github.repository`, so a
same-repo PR still publishes its `pr-<n>` tag while a fork's build switches its
bake output to `type=cacheonly` and skips the registry login, the digest upload,
and the whole `merge` job. GitHub withholds secrets from fork PRs, so the login
there could only ever fail; this way the build is still a real gate (and still
warms the layer cache) without needing a credential. `secrets.registry_password`
is `required: false` for the same reason.

**Not verified**: an actual release running end-to-end on GitHub Actions
(creating a real tag/release and pushing the version bump back to `main`). The
earlier Gitea-era verification of `scripts/bump-version.ts` and
`scripts/build-packages.ts` still stands (both were run for real locally, all
six binaries cross-compiled), since neither is host-specific.

## Homerun Agent + installer (`cmd/agent/`, `cmd/installer/`)

Two standalone sub-projects under `cmd/`, siblings of `src/` and **not** part of
the SvelteKit build. Both are Go now (a Go module at the repo root, `go.mod`,
shared with `cmd/cli/`, no `tsconfig.json`/`package.json` of their own). The
agent was originally Bun/TypeScript and was rewritten to Go for the same reason
the installer was before it: a `bun build --compile` binary embeds the whole Bun
runtime (~81MB for a Go-sized program), a plain Go binary is a few MB. The
installer's own earlier TypeScript→Go rewrite was verified behaviour-identical
against the old build (`--mode=agent` and both `--mode=full` variants — the
`--mode=full` runs came back byte-identical, the only `--mode=agent` difference
was cosmetic, a literal `<uid>` placeholder the old code printed in one dry-run
step where the new one prints `1000`). See each folder's own README for the full
detail; this section is the pointer.

The Agent is a selectable build-server connection kind
(`remote_host.kind: "agent"`, `$lib/services/agent-client.service.ts`'s
`AgentClientService`, see Build servers above for the wiring). The installer
stays standalone tooling (it's not imported by `src/` and isn't meant to be, it
drives a target machine's shell, not this app's own runtime).

- **`cmd/agent/`**, the **Homerun Agent**: a small token-authenticated HTTP
  server meant to run on a build server's own Docker daemon
  (`internal/agent/server.go`'s `Server.Handler`). Five routes: `GET /v1/health`
  and `GET /v1/openapi.json` unauthenticated (the latter for the same "spec
  describes shapes, not data" reason the main app's is public, health so a
  monitor can probe liveness without holding the token), `POST /v1/build`,
  `GET /v1/stats` and `GET /v1/images/save` behind
  `Authorization: Bearer <token>`. It is **not** a deploy target : the
  deploy/lifecycle/logs routes it used to carry were removed along with remote
  deploys (see Build servers above), and `AgentClientService.verifyToken` probes
  `/v1/stats` for exactly that reason. This is the alternative to registering a
  build server by raw `tcp://`/`ssh://` Docker socket : instead of exposing the
  daemon itself, the build server runs this agent and the main app only ever
  talks HTTP-plus-bearer-token to it. **Arch detection is now genuinely
  shared**, not just mirrored by hand: `internal/release.Arch` (already
  `amd64`/`arm64`, no remapping needed) and `internal/release.AssetSuffix` (the
  same, plus a `darwin-` prefix for macOS) are the one place this repo maps a Go
  arch/platform onto a release-asset name; `internal/installer/detect.go`'s
  `Arch()` and `internal/cli/update.go`'s `assetSuffix()` both just call through
  to it now, rather than each keeping its own hand-written copy (a real
  de-duplication this Go rewrite bought, since Bun and Go couldn't share a
  module before). **Wired into the main app**: `remote_host.kind` (`"docker"` |
  `"agent"`) + `agentUrl`/`agentTokenEnc` (schema.ts), `AgentClientService`
  (`$lib/services/agent-client.service.ts`, a thin HTTP client over
  `build`/`stats`/`health`), and the Remote Hosts "new host" form's
  connection-type toggle; `deploy/worker-spec.ts`'s `buildServerSpec` embeds the
  resolved target's kind in the deploy spec, and `internal/jobs/deploy/build.go`
  branches on it to build through a remote `dockerapi.Client` (a `"docker"`
  host) or over HTTP to the agent (`agentBuild`, `AgentClientService`'s Go
  equivalent). `internal/agent/build.go`/`git.go`/`builders.go` are no longer a
  from-scratch reimplementation of anything in `src/` (see "The agent's git
  builds" above) : the homerun worker imports that same package directly.
  `internal/agent/stats.go` still is, of `SystemStatsService`, since the agent
  has no access to the main app's database or config; keep the two in sync by
  hand if one changes (the `subproject-sync` agent's job).
  `internal/agent/build.go`'s `BuildInput` struct is the build body's shape,
  hand-validated by `validateBuildInput` in `internal/agent/server.go` (no
  schema library, this is Go, not zod), and `internal/agent/openapi.go`
  generates the agent's own OpenAPI 3.1 doc from plain Go literals describing
  the same shapes, the "one schema, two purposes" approach the main app uses
  with zod (see OpenAPI above) without a shared runtime to hang a real schema
  library off. `internal/agent/builders.go` embeds `internal/agent/builder.sh`
  and `internal/agent/builder-tools.json` (`//go:embed`), the
  generated-and-pinned build-tool script and checksums both the agent and the
  homerun worker run; golden files under
  `tests/unit/go/internal/agent/testdata/*.json` plus
  `tests/unit/app/agent-builder-parity.test.ts` (on the app side, now only
  checking `$lib/build-methods` against `builder-tools.json`'s method list and
  bake defaults, the form options the app still owns) keep the two from drifting
  on what the UI offers versus what the builder accepts.
- **`cmd/installer/`**, a single-binary installer
  (`internal/installer/installer.go`) meant to be the target of a `curl | bash`
  one-liner (`cmd/installer/bootstrap.sh`) on a fresh Linux server.
  `--mode=full` defaults to the **system (rootful)** daemon (`options.go`'s
  `DockerFlavourOf`): enables it, makes it a swarm manager (`swarm.go`'s
  `EnsureSwarmManager`, `--advertise-addr=` or the default-route address),
  creates the `homerun` bridge and the attachable `homerun-swarm` overlay, and
  writes a compose file whose Traefik runs the swarm provider too, so the app
  boots in swarm mode (see Swarm mode in `docker.md`). The trade-off is a root
  daemon. `--docker=rootless` (and `--mode=agent`, always) installs Docker
  Engine + rootless prerequisites (`uidmap`/`dbus-user-session`), creates a
  dedicated non-root system user, installs **rootless** Docker for it via
  Docker's own documented flow (`get.docker.com/rootless` →
  `dockerd-rootless-setuptool.sh`, `loginctl enable-linger` + a `systemd --user`
  unit so the daemon survives a headless reboot without an active login
  session), creates `homerun` on that daemon, then installs the Agent
  (`--mode=agent`, default, own `systemd --user` unit) or the standalone full
  stack under that account, never as root. `--migrate-to-rootful`
  (`migrate.go`'s `Migrate`) moves a rootless full install onto the system
  daemon in swarm mode, volumes and all, and is re-runnable; `--image=` swaps
  the app image (the e2e suite uses it to run a locally built one). **Binaries
  and Docker images only, nothing built from source on the target host**
  (superseding an earlier draft that cloned the repo and ran `bun run build`
  there): `bootstrap.sh` downloads the `homerun-installer-<arch>` release binary
  itself and `exec`s it (no Bun, no git); `--mode=agent` downloads the matching
  `homerun-agent-<arch>` release binary straight to
  `/usr/local/bin/homerun-agent`; `--mode=full` writes a standalone
  `compose.yaml` (`fullstack.go`'s `fullStackCompose`, distinct from the root
  dev `compose.yaml`; see Docker integration above) pulling the published
  `docker.io/orochibraru/homerun` app image alongside Traefik/Postgres, then
  `docker compose pull && ...up -d`.

  **`--mode=full` resolves an address for the instance and it is never
  `localhost`** (`main.go`'s `resolveHost`): `--domain=` wins, else an
  interactive prompt (skipped when stdin isn't a TTY, which is every
  `curl | bash` install), else `detect.go`'s `HostAddress()` (the `src` of
  `ip -4 route get 1.1.1.1`, falling back to the first non-loopback
  `hostname -I` address). It becomes `baseDomain` in the generated
  `homerun.yaml` and the `ORIGIN` default in the generated `compose.yaml`, and
  `homerun.yaml` no longer carries its own `auth.origin` so those two can't
  disagree. **Real, reported bug this fixes**: the old `http://localhost:3000`
  default didn't just produce wrong absolute URLs, it made a fresh instance
  impossible to sign up to. With `ORIGIN` set, SvelteKit normalizes `event.url`
  to it, so better-auth derives its `baseURL`, and therefore its trusted
  origins, from `localhost` while the browser's `Origin` header is the real
  address, and `POST /api/v1/auth/sign-up/email` 403s with `Invalid origin`.
  `compose.prod.yaml` (the manual Option B path, where nothing can detect an
  address) makes `ORIGIN` required with `${ORIGIN:?...}` instead, the same
  fail-closed shape `AUTH_SECRET` already used.

  `release.go` is the one place both artifact kinds (release binaries vs. the
  Docker image) resolve from: `--version=` (a GitHub release tag, default
  `latest`) picks which release's binaries to fetch, but doesn't pin the app
  image the same way: `docker.yaml` tags images by commit SHA + `latest` only,
  there's no `:vX.Y.Z` image tag, a real asymmetry in this repo's release
  pipeline documented in that file rather than papered over. Every shell-out
  goes through one `StepRunner` (`exec.go`, a `Runner` interface so tests can
  fake it) so `--dry-run` (print every command instead of running it) is a
  single interception point, not scattered per-step conditionals. **Verified**:
  the full command sequence via `--dry-run` for both modes (including on a
  non-Linux dev machine, via a dry-run-only package-manager-detection fallback,
  and including the generated `compose.yaml` content), and that the compiled
  binary's dry-run output matches running from source.

  **The real, mutating steps are now verified too**, against two real disposable
  Multipass Ubuntu 24.04 VMs (superseding this section's earlier "needs a
  disposable VM/CI runner this environment doesn't have" note): `--mode=agent`
  end to end (real `apt`/Docker Engine install, real rootless Docker setup, real
  `systemd --user` unit, the Agent actually running and reachable over the
  network, health endpoint + OpenAPI both responding from outside the VM), and
  `--mode=full` end to end on a second VM (real rootless Docker, real
  `docker compose pull && ...up -d` bringing up Traefik, Postgres, and the real
  published `docker.io/orochibraru/homerun` app image, all healthy, dashboard
  reachable from outside the VM). See `cmd/installer/README.md` for the full
  verification notes and the real bugs this run found and fixed
  (AppArmor-restricted unprivileged user namespaces on Ubuntu 24.04, an
  RootlessKit privileged-port restriction blocking Traefik's 80/443, an unquoted
  YAML scalar in the generated compose file, a postgres-18 volume-mount-path
  mismatch, and a missing `ORIGIN` env var), all now fixed in `docker.go` and
  `fullstack.go` (these findings predate the Go rewrite, carried forward from
  the old TypeScript steps of the same name). `cmd/installer/swarm-join.sh` has
  since had its own real two-VM run (see Swarm mode in `docker.md`), replayable
  with `bun run e2e:multipass --swarm`. `--fresh-swarm` checks a default install
  boots in swarm mode and routes a 2-replica service, `--migrate` installs the
  previous release rootless, deploys a service with a named volume holding a
  marker, runs `--migrate-to-rootful` and checks users, mode, the redeploy, the
  marker's ownership and routing. `--local-image` builds the app image from the
  checkout and loads it into each VM, which app-side changes need since the
  installer otherwise pulls the published image.

  This whole run is reproducible, not a one-off: `scripts/e2e-multipass.ts`
  (`bun run e2e:multipass`) automates exactly this, builds the
  installer/agent/CLI binaries from local source (not a published release, so it
  catches a regression before it ships), launches two disposable Multipass VMs,
  runs the real installer binary on each (`--mode=agent` / `--mode=full`), signs
  up + onboards the bootstrap admin over the real HTTP API, registers the agent
  VM as a build server and deploys/stops/starts a real service, then drives a
  real `homerun login` device-code round trip plus every documented CLI command
  from a throwaway Docker container, tearing everything down after (`--keep` to
  leave it running, `--skip-build` to reuse a previous build). Deliberately
  **not** wired into any GitHub Actions workflow, this repo's CI runners have no
  nested virtualization for Multipass, it's a local-only tool to run by hand
  before cutting a release or after touching installer/agent/CLI code.

  `scripts/e2e-multipass-release.ts` (`bun run e2e:multipass:release`) is its
  mirror image, and the two share `scripts/e2e/` (`multipass.ts`, the VM/HTTP
  machinery both drive; `docs.ts`, the docs command extractor; `release.ts`, the
  GitHub-release resolver). Where the suite above builds from local source and
  runs the binaries directly, this one runs **only what's already published,
  using the commands the docs themselves print**: the one-liners are extracted
  from `docs/getting-started.md`, `cmd/agent/README.md` and
  `docs/api-and-cli.md` at run time and executed verbatim (`Vm.runScript` writes
  a documented block to a file and runs it rather than re-typing it), so a
  renamed flag or a moved `raw.githubusercontent.com` path fails the run. Phases
  are `--only=`/`--skip=` selectable: `docs` (cross-checks every place the same
  command is documented, asserts each documented URL exists in this checkout
  _and_ is live, and asserts the GitHub release under test really published all
  six binaries, no VM needed, seconds to run), `full`, `agent`, `remote`, `cli`,
  `compose` (`docs/getting-started.md`'s Option B, on rootful Docker). Because
  it tests what's published, a fix in the working tree isn't reflected until it
  ships, that's the point, not a gap, `--ref=<branch>` points the documented
  URLs at a pushed branch when verifying a docs/installer change before merging,
  and `--version=vX.Y.Z` pins a release instead of `latest`.

## Documentation (`docs/`, `README.md`, `CONTRIBUTING.md`)

Three audiences, three places, keep them apart:

- **`CLAUDE.md`** (this file): everything a future session needs that isn't
  derivable from the code, including the "real, tested finding" notes. Not
  user-facing.
- **`docs/*.md`**: the operator-facing guides, one flat page per feature
  (`getting-started`, `configuration`, `services` as the hub for the per-feature
  service pages, `stacks`, `templates`, `storage-volumes`, `backups`,
  `users-and-roles`, `authentication-providers`, `login-wall`, `dashboard`,
  `docker-cleanup`, `api-and-cli`, `faq-and-limitations` and the rest, every one
  listed by area in `docs/README.md`, which a new page must be added to), plus
  the root `README.md`; `CONTRIBUTING.md` covers the dev-workflow half. These
  are the source of truth, plain Markdown, readable straight from the repo. The
  commands they print are **executed verbatim** by
  `bun run e2e:multipass:release` (see above), so a stale install one-liner is a
  test failure, not just a doc nit. **Configuration docs are UI-first on
  purpose**: an operator is expected to configure Homerun from `/settings` and
  the onboarding wizard, never from a file. `docs/configuration.md` leads with
  the dashboard, treats `DATABASE_URL`/`AUTH_SECRET`/`ORIGIN` as the three
  unavoidable boot-time values, and demotes `homerun.yaml` to an optional
  config-as-code path. Don't reintroduce an env-var table as the opening
  section.

- **The website** (<https://homerun.orochibraru.com>): built from a **separate
  repository** that renders this repo's `docs/*.md` itself. It used to live here
  as `packages/docs/` (a static SvelteKit site published as
  `docker.io/orochibraru/homerun-docs`, from back when `agent`/`cli`/`installer`
  still lived under `packages/` too); that sub-project, its `scripts/docs.ts`
  wrapper, the `dev:docs`/`build:docs`/`check:docs` scripts, the `docs`
  Dockerfile stage and bake target, and every CI job building or publishing it
  are all gone. Don't reintroduce a docs site under `cmd/` or elsewhere in this
  repo.

## Self-update from the sidebar (`$lib/services/self-update.service.ts`, `$lib/remote/self-update.remote.ts`, `app-version.svelte`)

The sidebar prints the running version for everyone; admins also get a "vX is
available" notice that opens the update dialog. All of it loads through remote
queries (`getAppVersion`, `getReleaseStatus`, `getUpdatePreflight`) and one
`startSelfUpdate` command, so the layout never waits on GitHub or Docker.

**The version is `HOMERUN_APP_VERSION`, falling back to `package.json`**
(`$lib/server/app-version.ts`). Reading `package.json` alone is always one
release behind in a published image: `semantic-release` bumps it in the
`release` job, after the image was built, and the promote path retags a PR image
that was built before the merge. So `docker.yaml` takes an `app_version` input
(the `version` job's dry-run result) and bakes it as a build arg
(`docker-bake.hcl` → `Dockerfile` `ARG`/`ENV`), and `publish.yaml`'s `promote`
job no longer `imagetools create`s the app image: it builds
`FROM homerun:pr-<n>` + `ENV HOMERUN_APP_VERSION=<version>` for both platforms
(no `RUN`, so no QEMU) and pushes that as `vX.Y.Z` + `latest`. The agent image
is still a plain retag. Without this the notice would never go away after an
update.

**Latest release** is `GET /repos/orochibraru/homerun/releases/latest`, cached
on the service instance for ten minutes (five minutes after a failure, which
returns `null` rather than an error). Comparison is `self-update/version.ts`'s
small semver compare, a leading `v` is ignored and a non-version never counts as
newer. The sidebar refreshes `getReleaseStatus` on the same ten-minute interval,
so a release shows up without reloading the page or restarting the container.
The same status and start are exposed to admins as
`GET/POST /api/v1/instance/update` (`homerun instance status`/`update`), for
when the dashboard itself is unreachable; a refused start is a `409` carrying
`start()`'s message.

**Finding its own compose project.** The service inspects its own container
(`os.hostname()` first, then the 64-hex id out of `/proc/self/mountinfo`) and
reads `com.docker.compose.project`/`.service`/`.project.working_dir`/
`.project.config_files` (`self-update/compose-target.ts`). No labels, or no
container at all (dev), means "not supported" and the dialog says so. The host
path of the Docker socket comes from the container's own mount whose destination
is `config.docker.socketPath`, so the rootless installer layout
(`/run/user/<uid>/docker.sock` on both sides) and `compose.prod.yaml`
(`/var/run/docker.sock`) both work.

**Start sequence** (`SelfUpdateService.start`): refuse unless a newer release
exists, `JobWorker.hold()`, re-run the preflight (no `deploy` job queued or
running, no job of any type running, the worker has nothing in flight), pull
`docker:cli`, force-remove any stale `homerun-updater`, then create and start it
with the socket at `/var/run/docker.sock` and the working dir plus every config
file's dir bind-mounted at their host paths. Any throw releases the hold. The
helper is a plain container with restart policy `no` and no auto-remove,
independent of the app container, so stopping the app doesn't take it down and
its logs survive a failed run. Its script (`updaterScript`) bumps a pinned tag
first when the running image isn't `:latest` (`sed` over the config files for
`<repo>:<oldtag>`, and `HOMERUN_VERSION=<oldtag>` in `.env`, keeping the `v`
prefix style), then `docker compose -p <project> -f … pull <service>` and
`up -d --no-deps <service>`. Verified by running the generated `sed` lines in a
real `alpine:3` container against a sample compose file and `.env`, and
`docker:cli` does ship the compose plugin. **Not verified**: a real end-to-end
update on an installed instance, and the CI changes above (nothing here can run
GitHub Actions).

**The hold is in memory, not a DB column**, on purpose: it lives exactly as long
as the process that's about to be replaced, so the new container boots with the
worker running and there's no stale flag to clear if an update dies halfway.
It's on `globalThis` so an HMR-reloaded worker module sees the same flag.
`JobWorker.tick()` and `#pump()` both return early while held, jobs that get
enqueued meanwhile (schedulers, the API) just wait in `queued` and run after the
restart, and anything left `running` is requeued by the existing orphan recovery
on boot. Covered by `tests/unit/app/self-update.test.ts`.
