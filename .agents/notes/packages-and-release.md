# Agent, installer, release automation

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## The agent's git builds (`packages/agent/docker.ts`)

`buildFromGit` mirrors the main app's `docker/git-build.ts` by hand (the agent
can't import from `src/`), **including its clone-in-a-container shape**: it used
to `execFile("git", ...)` into a temp dir, and the agent image is `alpine:3`
plus a few libraries with no git binary at all, so every agent-dispatched git
build failed with ENOENT. It now pulls `alpine/git`, clones into a named volume,
tars the context back out with `getArchive`, and removes the volume in a
`finally`. The same fix, for the same reason, as the main app's.

**A private repo works too**: `buildInputSchema` carries an optional
`credential` (`{username, token}`) that `deploy.service.ts` fills from
`resolveGitCredential` and `AgentClientService.build` sends over, since the
agent has no access to the git-provider tables. `authenticatedCloneUrl` and
`redactCloneUrl` are hand-mirrored from `$lib/git-clone-url.ts`, and every log
line and error message goes through the redaction so a token can't reach the
deployment log.

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
and `packages/cli/generated/` from silently going stale after a REST API change.

`semantic-release`, driven by conventional-commit messages (this repo's commits
already follow `feat:`/`fix:`/`chore:`, no new discipline required). Runs as a
new `release` job in `.github/workflows/publish.yaml`, alongside the existing
`code_quality`/`build` jobs, on every push to `main`; a non-releasable push
(docs/chore-only) is a no-op, not a failure. One version number covers the whole
repo, the root app plus `packages/agent`/`packages/installer`/`packages/cli`'s
own `package.json`s all get bumped together by `scripts/bump-version.ts` (an
`@semantic-release/exec` `prepareCmd`, not `@semantic-release/npm`, this repo
has no npm package to publish, and `npm`'s plugin still wants registry-shaped
config even with `npmPublish: false`; a small script fits this codebase's
existing "hand-roll a small thing rather than fight a mismatched tool" posture
better, same instinct as the cron matcher/SigV4 client).
`scripts/build-packages.ts` cross-compiles all six `agent`/`installer`/`cli`
Linux binaries (x64 + arm64, each sub-project's own
`build:linux-x64`/`build:linux-arm64` scripts) so `.releaserc.json`'s
release-assets step has something to attach, directly serving the "installer
(and homerun agent) in each release artifact" TODO item, with the CLI's own
binary added the same way for consistency.

**Uses `@semantic-release/github`**, the official plugin: this repo is hosted on
GitHub (`github.com/orochibraru/homerun`) and runs on GitHub Actions. It
previously lived on a self-hosted Gitea and used
`@saithodev/semantic-release-gitea`; that migration is done, so don't
reintroduce Gitea-specific release/CI config.

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

## Homerun Agent + installer (`packages/agent/`, `packages/installer/`)

Two standalone Bun/TypeScript sub-projects under `packages/`, siblings of
`src/`, each its own `tsconfig.json` (**not** its own `package.json`/
`node_modules`, they share the root install, same as every other `packages/*`
sub-project, see the Commands section above) and **not** part of the SvelteKit
build, both compile to a native binary via `bun build --compile`. See each
folder's own README for the full detail; this section is the pointer.

The Agent is a selectable build-server connection kind
(`remote_host.kind: "agent"`, `$lib/services/agent-client.service.ts`'s
`AgentClientService`, see Build servers above for the wiring). The installer
stays standalone tooling (it's not imported by `src/` and isn't meant to be, it
drives a target machine's shell, not this app's own runtime).

- **`packages/agent/`**, the **Homerun Agent**: a small token-authenticated HTTP
  server meant to run on a build server's own Docker daemon. Four routes:
  `GET /v1/health` and `GET /v1/openapi.json` unauthenticated (the latter for
  the same "spec describes shapes, not data" reason the main app's is public,
  health so a monitor can probe liveness without holding the token),
  `POST /v1/build` and `GET /v1/stats` behind `Authorization: Bearer <token>`.
  It is **not** a deploy target : the deploy/lifecycle/logs routes it used to
  carry were removed along with remote deploys (see Build servers above), and
  `AgentClientService.verifyToken` probes `/v1/stats` for exactly that reason.
  This is the alternative to registering a build server by raw `tcp://`/`ssh://`
  Docker socket : instead of exposing the daemon itself, the build server runs
  this agent and the main app only ever talks HTTP-plus-bearer-token to it.
  **Arch detection is mirrored, not shared**:
  `packages/installer/steps/detect.ts`'s `Detector.arch()` and
  `packages/cli/update.ts`'s `#currentArch()` both map Node's `process.arch`
  (`x64`/`arm64`) onto this repo's release-asset naming (`amd64`/`arm64`),
  throwing/exiting with a readable message on anything else. They can't import a
  shared module : each sub-project's `tsconfig.json` scopes its own `include` to
  its own directory (`./**/*.ts`, resolved relative to that tsconfig), so a
  module outside `packages/installer/` or `packages/cli/` respectively isn't
  visible to either's typecheck. Keep both in sync by hand if the mapping ever
  changes. **Wired into the main app**: `remote_host.kind` (`"docker"` |
  `"agent"`) + `agentUrl`/`agentTokenEnc` (schema.ts), `AgentClientService`
  (`$lib/services/agent-client.service.ts`, a thin HTTP client over
  `build`/`stats`/`health`), and the Remote Hosts "new host" form's
  connection-type toggle; `deploy.service.ts` branches on
  `RemoteHostDTO.resolveBuildTarget()`'s `kind` to route a git build through
  `DockerService` or `AgentClientService`. The agent has no access to the main
  app's source tree at runtime, so `packages/agent/docker.ts` and
  `packages/agent/stats.ts` intentionally re-implement (not import) the
  equivalent logic from `docker/git-build.ts` and `SystemStatsService`; keep the
  two in sync by hand if one changes. `packages/agent/schemas.ts` holds the zod
  schema for the build body, `safeParse`d at the route rather than cast, and
  `packages/agent/openapi.ts` generates the agent's own OpenAPI 3.1 doc from the
  same schema, the "one schema, two purposes" approach the main app uses (see
  OpenAPI above).
- **`packages/installer/`**, a single-binary installer
  (`packages/installer/index.ts`) meant to be the target of a `curl | bash`
  one-liner (`packages/installer/bootstrap.sh`) on a fresh Linux server:
  installs Docker Engine + rootless prerequisites
  (`uidmap`/`dbus-user-session`), creates a dedicated non-root system user,
  installs **rootless** Docker for that user via Docker's own documented flow
  (`get.docker.com/rootless` → `dockerd-rootless-setuptool.sh`,
  `loginctl enable-linger` + a `systemd --user` unit so the daemon survives a
  headless reboot without an active login session), creates the `homerun` on
  that rootless daemon, then installs either just the Agent (`--mode=agent`,
  default, own `systemd --user` unit) or the full stack (`--mode=full`), all
  under that same rootless account, never as root. **Binaries and Docker images
  only, nothing built from source on the target host** (superseding an earlier
  draft that cloned the repo and ran `bun run build` there): `bootstrap.sh`
  downloads the `homerun-installer-<arch>` release binary itself and `exec`s it
  (no Bun, no git); `--mode=agent` downloads the matching `homerun-agent-<arch>`
  release binary straight to `/usr/local/bin/homerun-agent`; `--mode=full`
  writes a standalone `compose.yaml` (`packages/installer/steps/full-stack.ts`,
  distinct from the root dev `compose.yaml`; see Docker integration above)
  pulling the published `docker.io/orochibraru/homerun` app image alongside
  Traefik/Postgres, then `docker compose pull && ...up -d`.

  **`--mode=full` resolves an address for the instance and it is never
  `localhost`** (`index.ts`'s `resolveHost`): `--domain=` wins, else an
  interactive prompt (skipped when stdin isn't a TTY, which is every
  `curl | bash` install), else `Detector.hostAddress()` (the `src` of
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

  `packages/installer/steps/release.ts` is the one place both artifact kinds
  (release binaries vs. the Docker image) resolve from: `--version=` (a GitHub
  release tag, default `latest`) picks which release's binaries to fetch, but
  doesn't pin the app image the same way: `docker.yaml` tags images by commit
  SHA + `latest` only, there's no `:vX.Y.Z` image tag, a real asymmetry in this
  repo's release pipeline documented in that file rather than papered over.
  Every shell-out goes through one `StepRunner` (`packages/installer/exec.ts`)
  so `--dry-run` (print every command instead of running it) is a single
  interception point, not scattered per-step conditionals. **Verified**: the
  full command sequence via `--dry-run` for both modes (including on a non-Linux
  dev machine, via a dry-run-only package-manager-detection fallback, and
  including the generated `compose.yaml` content), and that the compiled
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
  reachable from outside the VM). See `packages/installer/README.md` for the
  full verification notes and the real bugs this run found and fixed
  (AppArmor-restricted unprivileged user namespaces on Ubuntu 24.04, an
  RootlessKit privileged-port restriction blocking Traefik's 80/443, an unquoted
  YAML scalar in the generated compose file, a postgres-18 volume-mount-path
  mismatch, and a missing `ORIGIN` env var, all now fixed in
  `packages/installer/steps/rootless-docker.ts` and `.../steps/full-stack.ts`).
  **Still not verified**: `packages/installer/swarm-join.sh` (see Swarm mode
  above), this session's VM testing didn't touch it, it remains untested against
  a real second host or a real swarm, same caveat as before.

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
  from `docs/getting-started.md`, `packages/agent/README.md` and
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
- **`docs/*.md`**: the operator-facing guides (`getting-started`,
  `configuration`, `services`, `remote-hosts-and-agent`, `storage-and-backups`,
  `stacks-and-templates`, `users-and-access`, `api-and-cli`,
  `faq-and-limitations`, `operations`, indexed by `docs/README.md`), plus the
  root `README.md`; `CONTRIBUTING.md` covers the dev-workflow half. These are
  the source of truth, plain Markdown, readable straight from the repo. The
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
  `docker.io/orochibraru/homerun-docs`); that sub-project, its `scripts/docs.ts`
  wrapper, the `dev:docs`/`build:docs`/`check:docs` scripts, the `docs`
  Dockerfile stage and bake target, and every CI job building or publishing it
  are all gone. Don't reintroduce a docs site under `packages/`.

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
on the service instance for an hour (five minutes after a failure, which returns
`null` rather than an error). Comparison is `self-update/version.ts`'s small
semver compare, a leading `v` is ignored and a non-version never counts as
newer.

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
