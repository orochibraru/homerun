# Services

A **service** is one deployed container. Create one from `Services → New`,
either standalone or pre-filled from a [stack](stacks-and-templates.md) or
[template](stacks-and-templates.md#templates) via `?stackId=`/`?templateId=`.
The wizard's primary button, **Create and Deploy**, persists the config and
immediately deploys it, landing you on the new service's Overview tab; **Create
service**, the secondary button, just persists the config, the same as before,
deploy later from the Overview tab yourself.

## The services list

`Services` has a search box (matches name, image, and domain) plus Status/ Stack
filters, and a list/card view toggle that remembers your choice per browser;
both the search and filters are applied on the server, so they reach every
service you own, not just whichever page happens to be on screen. Once you have
more than a page's worth, a pager at the bottom shows "26–50 of 60" and lets you
step through the rest. Check one or more services (a "select all" scopes to
whatever's on the **current page**, paginating or changing the search/filters
clears your selection) to bring up a bottom bar with bulk
Start/Stop/Restart/Delete: bulk actions run against every selected service and
report back which ones succeeded, so one service with no container yet doesn't
block the rest. Bulk delete, and the single-row delete on this page and the
danger-zone delete on a service's own Settings tab, all require typing a
confirmation phrase (the service's name for a single delete, `delete N services`
for a bulk one) before the button unlocks, an irreversible action gets a real
"are you sure" rather than a single click. A delete removes the container or
swarm service first: one that's already gone is fine, but if Docker fails to
remove it, the service is kept and the error says why. The Settings tab's delete
then offers **Delete anyway**, which removes only Homerun's record (the REST
API's equivalent is `DELETE /api/v1/services/:id?force=true`).

## Deploy source: image or git repo

Every service is either:

- **Bring-your-own-image** (the default), an image + tag, optionally with
  private registry credentials.
- **Build from a git repo**, Homerun clones the repo (shallow, by branch, tag or
  full 40-character commit SHA, which pins the service to that commit) and
  builds it locally with the service's **build method**. No registry involved:
  the build produces a fresh local image tag
  (`homerun-build-<slug>:<timestamp>`) every deploy.

### Build methods

A git-based service picks how it's built on the Source tab (and in the wizard):

- **Dockerfile** (the default): the repo's `Dockerfile`, or the path you set,
  relative to the build context, built with BuildKit
  (`docker buildx build --load`). Everything BuildKit supports works:
  `# syntax=` directives, `COPY --chmod`, `RUN --mount=type=cache`, multi-stage
  builds.
- **Docker Bake**: one target of a bake file, `docker buildx bake`. Set the
  **bake file** (relative to the build context, default `docker-bake.hcl`; a
  `docker-bake.json` or a compose file works too) and the **bake target**
  (default `default`). The target can be a group, as long as it resolves to a
  single target, otherwise the build fails and names the targets it found.
  Whatever tags and outputs the target sets, Homerun overrides them so the image
  is loaded into the daemon under its own `homerun-build-<slug>` tag. Contexts
  in the file resolve from the build context directory.
- **Nixpacks**: detects the language and builds without a Dockerfile.
- **Railpack**: Railway's successor to Nixpacks, same idea.
- **Heroku buildpacks**: Cloud Native Buildpacks on `heroku/builder:24`.
- **Paketo buildpacks**: Cloud Native Buildpacks on
  `paketobuildpacks/builder-jammy-base`.

Every method runs as a throwaway `docker:cli` container (pinned to
`docker:29.8.1-cli`, which ships the buildx plugin) on the daemon doing the
build, with that daemon's socket mounted: `/var/run/docker.sock` on a
[build server](remote-hosts-and-agent.md), and Homerun's own configured socket
path for a local build, so rootless Docker works locally. A failed build's error
names its most telling line, usually BuildKit's final `ERROR:` line, and the
full output is in the deploy log. For Nixpacks, Railpack and buildpacks, the
first build on a host downloads the pinned builder binary (Nixpacks 1.41.0,
Railpack 0.39.0, pack 0.40.9) from GitHub into a `homerun-builder-tools` volume,
later builds reuse it. Both the download and the installed binary are checked
against pinned sha256 checksums, before first use and on every build, and a
mismatch fails the build rather than running an unverified binary. The build
context field still applies: point it at a subdirectory for a monorepo.
Configure the builder the way its own docs say, from the repository
(`nixpacks.toml`, `railpack.json`, `project.toml`, `Procfile`), there are no
per-builder fields here. The same methods work on
[build servers](remote-hosts-and-agent.md), both Docker connections and the
Homerun Agent, as long as a Docker connection's socket lives at
`/var/run/docker.sock` (rootless Docker doesn't). Nixpacks and buildpacks don't
read a build cache registry's layer cache; buildpacks keep theirs in
`pack-cache-*` volumes on the build host.

Toggle between the two on the **Source** tab (also available on the New Service
wizard). Any git-clone-able HTTPS URL works, GitHub, GitLab, a self-hosted
Gitea, anywhere, since cloning doesn't need a provider-specific API. If you've
connected a git provider account (`/git-providers`, OAuth), the Source tab gets
a repo-browsing picker instead of pasting a raw URL; a private repo can also
fall back to a token embedded directly in the URL (`https://TOKEN@host/...`)
without connecting a provider at all.

### Deploy on push

Turn on **Deploy on push** on the Source tab (or in the wizard) and every push
to the service's branch deploys it, as its owner, without you touching the
dashboard.

- **Picked from a connected account**: Homerun adds the webhook to the repo
  itself when you save, and removes it when you turn deploy-on-push off, switch
  repos or delete the service. The Source tab says when it's registered.
- **A pasted clone URL**, or when Homerun couldn't register it (the account
  lacks webhook access, the provider couldn't be reached): the Source tab shows
  a payload URL and a secret, with the reason. Add a webhook in the repository's
  settings with those, sending push events as JSON. On GitLab the secret goes in
  **Secret token**.

Pushes to other branches, tags and pings are acknowledged and ignored, and a
delivery with a wrong signature is refused. A service pinned to a commit SHA
never matches a push. Webhooks need the **Dashboard URL** set under Settings →
General, and that address has to be reachable from the git provider.
`GET /api/v1/services/{id}/webhook` returns the same URL and secret.

**A dashboard the provider can't reach** (only on your LAN, behind a VPN):
whenever Homerun couldn't register the webhook, it polls the branch instead,
reading its head commit through the provider's API every two minutes with the
service owner's connection (or a token in the clone URL) and deploying when it
moves. The first read only records where the branch is. Tick **Poll the branch
for pushes** to poll even when a webhook is registered, for a provider that
accepts the webhook but can't deliver it. Polling needs a GitHub, GitLab, Gitea
or Bitbucket API, the same way status checks do.

**Reconnect to allow webhooks.** When the provider refuses to add the webhook (a
connection authorized without webhook access, a revoked token) or the service's
owner isn't connected any more, the Source tab offers **Reconnect** right there.
It goes through the provider's consent screen, brings you back to the Source
tab, and registers the webhook of every service of yours on that provider that
was missing one.

Without it, redeploy a git-mode service like an image-mode one: manually, or on
its own cron schedule (below).

### Connecting a git provider

`Git Providers` in the sidebar is what turns "paste a clone URL" into "browse my
repos", and it's how a private repo works without putting a token in the URL.
There are two steps, and they're done by different people:

1. **An admin registers an OAuth app**, once per provider. Pick GitHub, GitLab,
   self-hosted Gitea (which also wants its base URL) or Bitbucket, register an
   OAuth application on that provider's own site, and paste the client id and
   secret in. The page prints the exact callback URL to register on the
   provider's side.
2. **Each person connects their own account** from the same page, one click
   through the provider's consent screen. Connections are per-account: your
   token is yours, and another user connecting to the same provider gets their
   own.

Once connected, a service's Source tab (and the new-service wizard) picks the
repository and branch from that account instead of asking for a clone URL, and
checks the repo for a `Dockerfile`. Picking one also turns on
[Deploy on push](#deploy-on-push), with the webhook added for you. **Use a clone
URL instead** is still there for any other repo. Tokens are stored encrypted,
refreshed automatically when the provider issues short-lived ones, and
disconnecting removes them.

Cloning itself is provider-agnostic, so any public HTTPS git URL works with no
provider connected at all.

**Connections made before deploy-on-push existed** only allowed reading repos on
GitLab, Gitea and Bitbucket. The Source tab offers to reconnect them once
Homerun is refused; until then it shows the webhook to add by hand.

### Pull request previews

Tick **Pull request previews** on a git service's Source tab and every pull
request opened on its repo gets a service of its own, `<slug>-pr-<number>` (so
`<slug>-pr-<number>.<baseDomain>`), built from the pull request's head and
deployed as the service's owner. Each push to the pull request redeploys the
preview; closing or merging it deletes the preview, container, DNS records and
all. GitHub, Gitea and GitLab previews build the exact head commit; Bitbucket
only sends an abbreviated hash, so its previews build the head branch, which
covers every pull request previews are made for anyway.

**Pull requests from forks are never previewed.** On a public repo anyone can
open one, and a preview builds and runs its code with the service's env vars.
Homerun only previews a pull request whose head is positively the same
repository as its base (GitHub and Gitea compare the head and base repository,
GitLab the source and target project, Bitbucket the source and destination
repository); a fork, or a payload that doesn't say, is acknowledged and ignored.

A preview copies the service's build settings, env vars, resources, stack and
login wall when it's created and again on every update, but not its volumes,
custom domain, cron schedule or status checks. Previews are listed under the
toggle, and each is a normal service you can open, redeploy or delete (a push to
its pull request brings it back). Turning previews off, or deleting the service,
deletes every preview.

Previews ride on the same webhook as deploy on push: turning them on
re-registers the webhook to also send pull request events. A webhook added by
hand needs **Pull requests** (GitHub, Gitea), **Merge request events** (GitLab)
or the **Pull request** created, updated, merged and declined triggers
(Bitbucket) ticked too. Polling doesn't cover pull requests.

### Required status checks

A git-mode service can refuse to build until its CI agrees. On the **Source**
tab, tick **Require status checks to pass before building** and pick the checks
that must pass. The picker lists every check name reported on the latest commits
of the service's branch, read live from the git provider: GitHub check runs and
commit statuses, GitLab job statuses plus the pipeline itself (as `pipeline`),
Gitea/Forgejo commit statuses, and Bitbucket build statuses (by key). A check
that hasn't run recently can be added by name.

On every deploy of that service, whatever triggered it (Deploy, the API or CLI,
a scheduled redeploy, a stack or template deploy), Homerun first resolves the
branch to a commit through the provider API and reads the checks for that exact
commit:

- every selected check passed (neutral and skipped count as passed): the build
  goes ahead, pinned to that commit even if the branch moved in the meantime,
  whether it builds on this host, a Docker connection or a Homerun Agent;
- any selected check failed or was cancelled: the deploy stops before cloning;
- checks still running: the deploy waits, polling every 20 seconds and logging
  changes into the deployment log, for up to 30 minutes, then gives up;
- a selected check that never reports, once everything else on the commit has
  finished, is treated as failed after a 3 minute grace period.

A stopped build is a failed deployment with the reason in its log, the running
revision is left untouched, and a **Status checks failed** notification goes to
the bell and to every notification channel subscribed to it, saying which checks
failed and that the build won't carry on. The provider API is called with your
connected git provider account, a token embedded in the clone URL, or
unauthenticated for a public repository on github.com, gitlab.com or
bitbucket.org. A self-hosted instance needs to be configured under Git
Providers. Agent build servers clone the branch head themselves, so a build
there isn't pinned to the checked commit.

### Build servers and build cache

By default a git build runs on this host. Two optional pickers on the Source tab
change that:

- **Build cache registry**, a registry credential registered under
  `/build-cache-registries`. Dockerfile, Docker Bake and Railpack builds use it
  as a BuildKit registry cache: `--cache-from`/`--cache-to type=registry` at
  `<registry>/homerun-build-<slug>:buildcache`, `mode=max` so intermediate
  stages are cached too. A repeat build reuses what the last one produced, even
  on a fresh builder. Both directions are best-effort: a missing cache (the
  first build) or a failed cache export logs and carries on. The registry cache
  needs BuildKit's `docker-container` driver, so these builds run on a
  persistent `homerun-cache` builder (a `buildx_buildkit_homerun-cache0`
  container on the building daemon, host networking, created on first use), and
  the image is loaded into the daemon afterwards. Builds without a cache
  registry use the daemon's own builder and its local cache.
- **Build server**, a second machine that compiles the image instead of this
  one, see [Build servers](remote-hosts-and-agent.md). With a cache registry the
  built image is published there and pulled back; without one it's streamed
  straight back from the build server (`docker save` into `docker load`).

## Importing a compose file

**Import compose** on the services list takes a `docker-compose.yaml` pasted
straight in and turns it into Homerun rows. Parsing happens on the server and
nothing is created until you confirm: the preview lists every service it found
with the image, port, protocol, network mode, env var count and volume mounts it
resolved, plus a warning for anything it had to drop.

What maps across: `image`, `environment` (both the map and the `KEY=VALUE` list
form), `ports`/`expose` (the container side, the host side is dropped, Homerun
routes through Traefik instead), `restart`, `volumes` (named volumes and
absolute bind mounts, in both the short `src:dst:ro` and long `type:/source:`
forms), `depends_on`, `network_mode: host`, `container_name`,
`deploy.resources.limits.cpus`/`memory`, and everything on the
[Runtime tab](#runtime): `command` and `entrypoint` (string or list form),
`labels` (Traefik and `homerun.*` labels are dropped, Homerun writes its own
routing), `cap_add`, `devices` and `privileged`.

`env_file` is resolved into env vars where it can be: the preview asks you to
paste the contents of every relative env file the compose file references, and
their variables are imported (the service's own `environment` wins on a clash).
An absolute path you don't paste is kept as an [env file](#env-files) and read
from the host at every deploy. A relative one left blank is skipped.

What comes back as a warning instead of being applied: `build:` (import it, then
point the service's Source tab at a git repository), `healthcheck`, `cap_drop`,
`extra_hosts`, `sysctls`, `tmpfs`, `user`, secrets/configs, relative bind mounts
(Homerun needs an absolute host path), and anonymous volumes.

Every named volume and absolute bind mount becomes a
[storage volume](storage-and-backups.md) (reusing an existing one when the
source matches) and is mounted into the service at its declared path. A service
that published a host port gets a public `<slug>.<domain>` route; one that only
`expose`d a port stays internal. You can drop individual services from the
import, put them in a new or existing stack, and optionally deploy everything
straight away, in `depends_on` order.

## Migrating from Dokploy or Coolify

**Settings → Migrate** (admin-only) reads another PaaS instance and recreates
what it finds here. Pick Dokploy or Coolify, give it the instance URL and an API
token, and **Read instance** lists every application, compose stack and
database, grouped by the project it lives in. It only ever makes read requests:
nothing on the other side is stopped, changed or deleted, and the token is sent
with each request on that page, never stored.

Tick what you want and **Import**. Each source project becomes a Homerun stack,
and every entry goes through the same importer as
[Importing a compose file](#importing-a-compose-file), so volumes, slugs and
warnings behave the same way. Nothing is deployed: each imported service waits
until you deploy it.

What carries over:

- **Docker image apps**: image and tag, env vars, the port of their first domain
  (public) or internal-only when they had no domain, CPU/memory limits,
  named-volume and bind mounts, and Dokploy's private registry credentials.
- **Start commands**: a Dokploy command runs through `/bin/sh -c` and its
  arguments replace the image's, the same way Dokploy starts it. On Coolify,
  `start_command` becomes the container command, and the custom docker run
  options Homerun can apply (`--cap-add`, `--device`, `--privileged`, `--label`,
  `--entrypoint`) land on the [Runtime tab](#runtime); any other flag is a
  warning.
- **File mounts and storage**: a Dokploy file mount (on an app, a database, or
  bound from a compose stack's `../files/` directory) is written under
  `/var/lib/homerun/files/<slug>/` on this host and bind-mounted read-only at
  the same path. Coolify persistent volumes, host binds and file storages come
  across the same way when Coolify's API lists them.
- **Git apps**: become [git-based](#deploy-source-image-or-git-repo) services
  with the repository, branch, build context and [build method](#build-methods):
  a Dockerfile (with its path), Nixpacks, Railpack, or Dokploy's Heroku and
  Paketo buildpacks. Custom install or build commands set on Coolify aren't
  carried over, put them in the builder's config file in the repository. A
  private repository needs a
  [connected git provider](#connecting-a-git-provider).
- **Compose stacks**: the stored compose file, with the stack's own variables
  substituted in. On Dokploy, each domain's port is applied to the service it
  targets, and named volumes keep pointing at the data Dokploy created
  (`<appName>_<volume>`, or the volume's own `name:`/`external` declaration).
- **Databases**: the image, the port, and the credentials turned into the
  image's own env vars (`POSTGRES_PASSWORD`, `MYSQL_ROOT_PASSWORD`, ...), always
  internal-only. A Redis, KeyDB or Dragonfly password is applied through the
  start command, the way both platforms set it.

What doesn't, and shows up as a blocked entry or a warning instead: apps built
with a static build pack, and compose stacks read from a repository at deploy
time. Coolify doesn't expose registry credentials, and older Coolify versions
don't list persistent storage in their API: the import says so, re-attach those
volumes by hand.

For Dokploy, create the token under **Settings → Profile → API/CLI**. For
Coolify, create it under **Keys & Tokens** with the `read` and `read:sensitive`
permissions: without `read:sensitive`, env values and database passwords come
back hidden.

## Deploying

The Overview tab has Deploy/Start/Stop/Restart plus a live progress panel. The
panel shows six phases, resolving configuration, preparing volumes, fetching
image, provisioning container, routing traffic, ready, ticking off as they
complete, with the raw build/pull output streaming underneath. Progress arrives
over server-sent events (the server pushes each new line and status change; if
that stream can't be held open, the panel falls back to polling), and it resumes
correctly if you reload the page mid-deploy, or if the deploy was started
somewhere else entirely (a template quick-deploy, cron). Below it sit a
**Resource usage** chart for the service's own container (CPU, memory and
network traffic, live or over the last hour, day, week, month, year or all of
it, sampled every minute), a **Connections** panel listing the services it
references through env vars and the ones that reference it, and a tail of its
live logs. Deployment history, every attempt with its status, image and full
log, is on the [Revisions](#revisions-and-rollback) tab.

**Redeploys are health-gated.** When the service already has a running
container, the new one starts next to it and the old one keeps serving until the
new one is ready: its healthcheck (the image's own `HEALTHCHECK` or the
service's healthcheck command) passes, or, with no healthcheck, it has kept
running for 5 seconds. Traefik doesn't route to a container whose healthcheck
hasn't passed yet, so traffic only moves once it's ready; then the old container
is removed. If the new container exits, restarts, reports unhealthy or isn't
ready within 5 minutes, it's removed instead, its last log lines go into the
deploy log, the deploy is marked failed and the old container carries on
untouched. Without a healthcheck the new container starts taking traffic next to
the old one as soon as it runs, so add one for a real gate. Two cases still stop
the old container first: **host networking** (both copies would bind the same
ports) and a **writable volume** (two copies writing the same data, a database's
data directory for instance). In [swarm mode](#swarm-mode) the same happens
through swarm's own rolling update: the service is updated in place,
start-first, waits for each new task's healthcheck and rolls back to the
previous tasks on its own when one fails.

### Revisions and rollback

Every deploy that reaches running is a **revision**: the exact image it ran
(`image:tag` plus the registry digest when there is one, or the local
`homerun-build-<slug>:<tag>` for a git build), the commit and branch for a git
build, and whether it stayed healthy. The **Revisions** tab lists them with the
current one marked, next to failed attempts and their logs.

**Deploy this revision** (confirmed in a dialog, also
`POST /api/v1/services/:id/revisions/:revisionId/deploy` and
`homerun services rollback`) queues a deploy that skips the build, the registry
pull and the image scan, and starts that exact image: by digest for a pulled
image (pulled again by digest if it was removed from the host), or the retained
local build for a git service. The service's image and tag are set back to the
revision's, so a later redeploy starts from there. By default only the image is
rolled back and environment variables, volumes, networking and resources stay
the service's current ones, since those are usually edited deliberately.

Tick **Also restore env vars, resources and networking** in the confirm dialog
(`?restoreConfig=true` on the API, `--restore-config` on the CLI) to put back
what that revision ran with as well: its environment variables, CPU and memory
limits, replicas, container port and protocol, network mode and whether it's
publicly routed, plus its [runtime options](#runtime). Every deploy records
those on its revision, so this works for any revision deployed since the option
existed; an older one logs that it has nothing to restore and rolls back the
image only. Volumes and the custom domain are never rolled back. The restored
values are written onto the service, so the next deploy keeps them.
Auto-rollback only rolls back the image.

The last 5 distinct images of every service are **retained** (change the count,
from 1 to 50, under **Settings → Docker → Retained images**): Docker Cleanup's
image prune (including **Quick cleanup**) and the image mirror cleanup skip
them, so rolling back to any of them never needs a rebuild. Older revisions stay
listed but may need their image pulled or rebuilt.

**Auto-rollback.** After each deploy the new workload is watched for 90 seconds,
longer while its healthcheck is still starting (up to 5 minutes). It's unhealthy
when the container exits, restarts twice or more, or its Docker healthcheck
(including the service's own healthcheck command) reports unhealthy, or for a
swarm service when two tasks fail or not every replica is running. An unhealthy
revision is always marked on the Revisions tab and reported (**Revision
unhealthy**). With **Auto-rollback when a new revision is unhealthy** turned on
in the service's Settings tab (off by default), Homerun instead redeploys the
previous healthy revision with a different image, marks the new one as rolled
back and sends **Rolled back**. A rollback that is itself unhealthy isn't rolled
back again.

Clicking Deploy **queues** the deploy rather than running it inside the request
(see [The job queue](#the-job-queue) below), so the button comes back
immediately and the progress panel narrates the rest. Same for "Create and
Deploy" at the end of the new-service wizard: it creates the service, queues the
deploy, and drops you straight on the service page watching it come up.

## Image scanning

Every deploy scans the image for known vulnerabilities with
[Trivy](https://trivy.dev) before the workload starts. It's on by default and
never enforced unless you ask for it.

For an image-based service the pull goes through a registry mirror Homerun runs
for itself, `homerun-mirror` (a `registry:2` container on the shared network,
data in the `homerun-mirror-data` volume, published on `127.0.0.1:5055` only).
The deploy:

1. copies the image from its registry into the mirror with a throwaway
   [skopeo](https://github.com/containers/skopeo) container, using the service's
   registry credentials if it has any, without pulling it onto the host first;
2. scans the copy in the mirror with a throwaway Trivy container (the
   vulnerability database is cached in the `homerun-trivy-cache` volume, so only
   the first scan downloads it);
3. pulls the scanned image from `127.0.0.1:5055` onto the host and tags it with
   its usual name, so the container runs exactly what was scanned. On rootless
   Docker, whose daemon can't reach that loopback port, and whenever that pull
   fails, a throwaway skopeo container streams the scanned image out of the
   mirror straight into the daemon (`docker load`) instead.

In [swarm mode](#swarm-mode) the other nodes can't reach a loopback mirror, so
the service is deployed from the upstream registry pinned to the scanned digest
(`image:tag@sha256:...`) instead.

The mirror is created the first time it's needed. If the copy into the mirror
fails, the deploy log says why and the deploy falls back to a normal pull, then
scans the image on the host through the Docker socket; if the scanned image
can't be pulled or loaded out of the mirror, it's pulled from its registry. A
pull policy that skips the pull scans the image already on the host. Git-built
images are scanned once built: on the host for a local build, in the build cache
registry (falling back to the host) for a build server with one, on the host for
a build server without one.

The mirror is garbage-collected every day at 04:00, and on demand from
[Docker Cleanup](operations.md#image-mirror). For every service it keeps the
image the service currently points at, the digest its last successful deploy
ran, and its last two scanned versions (so a rollback or a rescan still finds
them); everything else goes, including images of deleted services.

The deploy log gets a summary line with counts per severity and the first few
CRITICAL/HIGH findings. The service's **Security** tab shows the latest scan,
the severity counts, the findings (top 200, most severe first, with the fixed
version when there is one), the scan history, and a **Scan now** button that
queues a scan of the deployed image. A scan that finds a CRITICAL vulnerability
adds a bell notification and fires the **Critical vulnerabilities** event on any
notification channel subscribed to it. The same scans are in the
[REST API and CLI](api-and-cli.md#image-scans), including a
`homerun services scan <id> --fail-on high` for failing a CI job on findings.

Scanning is controlled in two places:

- **Settings → Docker → Image scanning**, admin-only: turn it off for every
  service, and set the deploy block policy (see below).
- **Scan this service's image** on a service's Settings tab, to opt one service
  out. An opted-out service pulls straight from its registry, and the block
  policy doesn't apply to it.

### Blocking deploys on findings

**Block deploys at severity** turns scanning from a report into a gate. Pick
`Off` (the default), `Critical`, `High and above`, `Medium and above` or
`Low and above`: a deploy fails if the image has at least one finding at or
above that severity. Findings of unknown severity never block. Tick **Only block
on fixable vulnerabilities** to count only findings that have a fixed version,
so a CVE with no upstream fix yet stays visible on the Security tab without
stopping every deploy.

When the policy blocks a deploy:

- the image is checked before the new workload starts, so the container (or
  swarm service) that was already running keeps running untouched. With the
  mirror, a blocked image never reaches the host at all; a git-built image is
  built (and, with a build server, pushed to the build cache registry) but never
  started;
- the deploy log gets the scan summary and a line naming the policy, the
  blocking counts per severity and the full scan's counts:

  ```text
  Blocked by the image scan policy (block at HIGH or above):
  3 vulnerabilities at or above the threshold (1 critical, 2 high).
  Full scan: 1 critical, 2 high, 14 medium, 3 low, 0 unknown.
  ```

- the deployment is marked failed with that message, and the usual **Deploy
  failed** bell notification and notification-channel event fire (plus
  **Critical vulnerabilities** if any were critical).

The policy applies to every deploy path that builds or pulls an image: the
Deploy button, the API and CLI, scheduled redeploys, git pushes, and stack or
template deploys. A scanner that can't run (no network for the database, a
registry it can't read) doesn't block by default: the deploy goes ahead and the
failed scan is recorded. Tick **Fail deploys when the image can't be scanned**
under Settings → Docker → Image scanning to fail those deploys instead, with the
previous container left running. [Rollbacks](#revisions-and-rollback) aren't
re-scanned or re-checked, since they redeploy an image that already ran here and
auto-rollback has to be able to recover a broken service.

The service's **Security** tab shows the current policy and whether its latest
scan passes it, so you can see before the next deploy whether it would be
blocked.

## The job queue

Deploys, git builds, image scans, volume backups and Docker cleanups all run
through one background worker instead of inside the request that triggered them.
That buys four things worth knowing about as an operator:

- **Repeats collapse.** Queueing a deploy for a service that already has one
  waiting doesn't queue a second, it joins the one that's already there. Push
  five times in a minute to a git-based service on a redeploy schedule and you
  get one build, not five.
- **One deploy per service at a time.** Different services still deploy in
  parallel (up to three jobs at once); the same service never deploys twice
  concurrently.
- **Linked services keep their order.** Deploying a template that links a
  database or cache queues the companions first and the primary service behind
  them, and if a companion fails, the primary is cancelled rather than started
  against a missing dependency.
- **A Docker cleanup runs alone.** A host-wide prune waits for anything already
  running to finish and holds new work back while it runs, so it can't delete
  images or build cache out from under a deploy in flight. It does take
  precedence over deploys that are merely queued.

The **Scheduling** page has a Job queue panel showing what's running, what's
waiting, and how recent jobs finished. Work that was still running when the app
was restarted is put back on the queue at next boot.

A failed deploy is not retried automatically, you'll see it fail and decide;
backups get one retry.

## Env vars

Plain key/value rows on the Env Vars tab, stored as-is (not encrypted, don't put
a raw plaintext secret you'd mind leaking in the DB dump into an env var if you
can avoid it; registry passwords and similar have their own encrypted fields
instead).

**Link a service** in the new-service wizard's Environment step fills those rows
in for you from a service you already run, in any stack or none: pick it, and
Homerun recognises what it is from its image (PostgreSQL, MySQL/MariaDB,
MongoDB, Redis/Valkey, RabbitMQ, or a plain HTTP service) and reads the
credentials off its own env vars. You then choose the shape you want:

- **Connection URL**, e.g. `POSTGRES_URL=postgres://app:secret@db:5432/app`.
- **JDBC URL** (relational engines only), e.g.
  `jdbc:postgresql://db:5432/app?user=app&password=secret`.
- **One variable per value**, e.g. `DB_HOST`, `DB_PORT`, `DB_USER`,
  `DB_PASSWORD`, `DB_DB`.

The suggested variable name (or prefix) is a default, not a rule, rename it to
whatever your app expects before adding it. The host in every generated value is
the linked service's slug, which is how services already reach each other on the
shared network, so this works across stacks and needs no extra networking.

### Env files

Under the variables, **Env files** lists `.env` files on this host, one absolute
path per line, read at every deploy through a short-lived helper container (so
they work even though Homerun itself runs in a container). A later file wins
over an earlier one, and the service's own variables win over both. A file that
can't be read fails the deploy, the same as a missing `env_file` fails
`docker compose up`. Only an admin can change the list, since the files are read
off the host.

## Volumes

Mount a [storage volume](storage-and-backups.md) into the container path of your
choice, read-write or read-only, from the Volumes tab, including creating a
brand-new volume inline without leaving the page. A volume becomes "shared"
simply by mounting it into more than one service.

## Networking

Everything on this tab is written onto the container as Traefik labels at
**create** time, so saving a change here doesn't affect the container that's
already running. Once a service has been deployed, the tab shows a **Redeploy**
button for exactly that reason, use it after changing a custom domain or
DNS-resolvability. The login wall is the exception: it applies as soon as you
save.

- **Container port, protocol, network mode**, `bridge` (default, joins the
  shared `homerun` plus the service's stack network if any) or `host` (shares
  the host's network namespace directly, for apps needing real host-network
  access like mDNS/SSDP discovery). Homerun never publishes/maps a host port
  either way; a bridge-mode service is reachable only via its Traefik subdomain,
  a host-mode service only directly on the host's own port.
- **DNS-resolvable**, whether Traefik gets discovery labels at all. Forced off
  automatically in host mode (there's no per-container IP for Traefik's Docker
  provider to route to).
- **Custom domain**, an optional second hostname (in addition to the automatic
  `<slug>.<baseDomain>` one), routed to the same backend.

### DNS automation

If your instance's DNS is on Cloudflare, or you front it with a self-hosted
[Pangolin](https://github.com/fosrl/pangolin) tunnel instead, configure one (or
both) from `/settings` → Networking and Homerun keeps DNS in sync on its own for
any service with **DNS-resolvable** on: a deploy creates or updates the record
(a Cloudflare CNAME, or a Pangolin Resource + Target), deleting the service
removes it, including its custom domain if it has one.

Both are best-effort and fire only after a successful deploy, a DNS failure
never fails the deploy itself. **What each provider did is written into that
deploy's own log**, so a sync that was skipped or rejected says so where you're
already looking, rather than only in the server's log. An empty result means no
DNS automation is configured, which is the default.

Neither is required. This is purely a convenience over pointing DNS at your
instance yourself.

**Cloudflare** needs an API token with the **Zone / DNS / Edit** permission on
the zone, plus the zone id. **Test connection** on the settings page checks that
the token can read the zone and list its DNS records, and that the zone actually
holds your base domain. It can't prove the token can write without writing, so a
read-only token still passes: the first deploy log is the real test.

What a sync does to a hostname's records, so re-running it is always safe:

- No record: creates a CNAME to your base domain, unproxied, automatic TTL, with
  the comment `Managed by Homerun`.
- A CNAME already pointing at your base domain: leaves it alone.
- A CNAME pointing elsewhere: changes only its target, so a proxy toggle, TTL or
  comment you set by hand survives.
- An A or AAAA record on that name: leaves it alone and says so in the deploy
  log, since Cloudflare won't allow a CNAME next to one.
- A hostname outside the zone (a custom domain on another DNS provider), or the
  base domain itself: skipped.

Deleting a service removes its CNAME only when it points at your base domain or
carries the `Managed by Homerun` comment, so a record you created by hand for
something else is never deleted.

**Pangolin** needs all of its fields, with any one blank the integration stays
off:

- **API base URL**: the **Integration API**, not the dashboard. Self-hosted
  Pangolin only exposes it once you enable it, it listens on its own port (3003
  by default), and its base path ends in `/v1`, e.g.
  `https://api.pangolin.example.com/v1`. A dashboard-style URL ending in
  `/api/v1` authenticates with a session cookie rather than an API key, so every
  call would fail.
- **Org ID** and an **API token** for it.
- **Main site name**: the Pangolin site (tunnel agent) whose host runs this
  instance's Traefik. It must already exist in Pangolin.
- Optionally a **target host**, the address the Pangolin site agent reaches
  Traefik at. Left blank it's detected: Traefik's container name when Newt runs
  as a container on the same network, `localhost` when it runs on this host with
  host networking. Set it when Newt runs on another machine. The page also tells
  you whether it found a Newt tunnel container on this host; the **Newt
  (Pangolin tunnel)** template deploys one.
- Optionally a **target port**, defaulting to 443, where this instance's service
  routers live. A target on 80 reaches an entrypoint with no matching router and
  Traefik answers 404.
- **Let Pangolin handle sign-in**, off by default. On, the Resources Homerun
  creates keep Pangolin's own SSO and the
  [per-app login wall](#per-app-login-wall) steps aside for anything Pangolin
  publishes, so visitors sign in once. Off, Homerun owns access and every
  Resource it creates has Pangolin SSO turned off.

**Test connection** checks the whole set rather than just that the token
authenticates: it confirms the site exists, and that one of your registered
Pangolin domains actually covers this instance's base domain, since without that
no service hostname could ever be routed. A token-only check passed on setups
that could never work. The domain must also be **verified** in Pangolin, and a
CNAME-type Pangolin domain only routes its own exact name, never a subdomain of
it. When several registered domains cover a hostname, the most specific one is
used.

Syncing Pangolin is safe to re-run too. An existing Resource for the hostname is
reused rather than duplicated: its SSO flag is changed only if it differs, and
its Target is repaired in place (host, port, scheme, site, enabled) instead of a
second one being added behind Pangolin's load balancer. A Resource you disabled
in Pangolin stays disabled, and the deploy log says so. Deleting a service
deletes its Resource, and one already removed by hand counts as done.

> Neither integration has been exercised against a real account by the
> maintainer yet, so verify the first real sync by reading the deploy log it
> writes to. See [FAQ & limitations](faq-and-limitations.md).

### Custom domains & SSL

A custom domain outside your instance's own base domain can't use Traefik's
automatic ACME resolver, so the Networking tab's SSL section lets you paste your
own cert/key PEM (encrypted at rest, same scheme as registry credentials). It
works out of the box: `compose.prod.yaml` and the installer's stack share a
`traefik-dynamic` volume between Homerun and Traefik, turn on Traefik's file
provider over it, and set `TRAEFIK_DYNAMIC_CONFIG_DIR` (see
[Configuration](configuration.md)) so Homerun knows where to write. Saving a
cert writes the cert, key and a dynamic-config file into that directory, and
Traefik's file provider picks them up on its own (no restart per certificate).
An instance started from an older compose file without that volume and those
flags has to add them once; until then, saving a cert does nothing.

### Per-app login wall

The Networking tab's **Access** section puts a login wall in front of the
service. An anonymous visitor is redirected to this instance's own sign-in
screen, and sent back to the page they asked for once they're through. Pick
which sign-in methods that app accepts (built-in login, and any OAuth provider
configured on the Authentication page), and optionally restrict access to
specific users, email addresses or provider groups. Turning the wall on or off
applies immediately, without a redeploy. Full detail, including what the app
receives about the signed-in visitor, is in
[Users & access](users-and-access.md#per-app-login-wall).

## Runtime

The **Runtime** tab changes how the container starts and what it can reach on
the host, all applied on the next deploy:

- **Entrypoint** and **Command** replace the image's own, split the way a shell
  would (quote an argument with spaces). They aren't run through a shell: use
  `sh -c '...'` for pipes or variables. Leave blank to keep the image's.
- **Labels**, one `KEY=VALUE` per line, added to the container (and to the swarm
  service in swarm mode). Homerun's own tracking and Traefik labels win on a
  clash, so a custom label can add a Traefik middleware but can't break the
  service's route.
- **Added capabilities** (`NET_ADMIN, SYS_TIME`), **Devices**
  (`host[:container[:rwm]]`, like `docker run --device`) and **Run privileged**.
  Only an admin can set or change these three: they give the container access to
  the host, so other roles see them read-only, and the REST API and compose
  import refuse them with a 403. Only an admin can deploy a template that sets
  them either. Swarm services can't run privileged or map devices, so those two
  are ignored in [swarm mode](#swarm-mode); capabilities, labels, command and
  entrypoint apply there too.

## Compute

CPU and memory limits on the Compute tab, applied as real Docker resource limits
on the next deploy. The same tab carries the replica count used by
[swarm mode](#swarm-mode); it has no effect in standalone mode, where a service
is always one container.

## Swarm mode

Instance-wide, opt-in (`/settings` → Docker → Orchestration mode → `swarm`), an
alternative to the default one-container-per-service model: once enabled, every
**local** deploy creates a real Docker Swarm Service instead of a plain
container, and the Compute tab gets a **replicas** field (default 1) controlling
how many copies Docker runs and load-balances across via its own routing mesh.
Start/ stop map to scaling to 0/back up rather than a real container stop/start,
and restart force-updates every task (recreating them) instead of restarting one
container.

Swarm mode needs Homerun on the **system (rootful)** Docker daemon: rootless
Docker can't create overlay networks, so saving **Swarm** on an instance running
on a rootless daemon fails straight away with a message saying so, before
anything on the host changes. The one-line installer sets up rootless Docker by
default; add `--docker=rootful` to put the stack on the system daemon instead
(see [Getting started](getting-started.md)).

Saving **Swarm** prepares the host for you: Homerun runs `docker swarm init` if
the daemon isn't a swarm manager yet, creates an attachable overlay network
(`<network>-swarm`, next to the shared bridge network), attaches Traefik to it
and turns on Traefik's swarm provider (`--providers.swarm`, the Traefik v3 form
of the old `--providers.docker.swarmMode=true`). That last step recreates the
Traefik container, so the dashboard may blink if you reach it through Traefik.
Homerun re-checks all of this when it starts, so a `docker compose up` that
recreates Traefik from your compose file doesn't silently drop the provider.
Switching back to **Standalone** turns the provider off again and leaves the
swarm itself running; run `docker swarm leave --force` yourself if you want it
gone. On a host with several network interfaces `docker swarm init` can refuse
to pick an address to advertise: run `docker swarm init --advertise-addr <ip>`
once by hand, then save the setting again.

The service's Overview tab lists every replica with its node, state and live CPU
and memory use. A replica scheduled on another node shows its state but no
usage, since Homerun only talks to this host's Docker daemon. The resource graph
below the list records the sum over the replicas running here.

**Adding a node**: a second machine joins the swarm as a worker rather than
being registered separately. On the manager, `docker swarm join-token worker`
prints the token and address; on the new machine:

```sh
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/swarm-join.sh \
  | sudo bash -s -- --token=<SWMTKN-...> --manager=<manager-ip>:2377
```

It installs Docker if needed, joins the swarm on the system daemon and installs
the Homerun Agent; the swarm scheduler places tasks there from then on and
Traefik on the manager routes to them over the overlay network. The machines
need to reach each other on 2377/tcp, 7946/tcp+udp and 4789/udp. Traefik picks
up new replicas within about 15 seconds. See
[`packages/installer/README.md`](../packages/installer/README.md) for the flags.

## Observability

The **Observability** tab is where a service tells you whether it's healthy:
uptime probes, live logs, failed deploys and the errors Homerun logged about it.

### Uptime

Every minute Homerun probes each deployed service two ways, and the tab draws
the recent results as two heartbeat strips with an uptime percentage, latency,
and the reason for the latest failure plus hints for fixing it:

- **From the network**: the container's own port, reached over the Docker
  network. It runs the service's [healthcheck command](#settings) when it has
  one, opens a TCP connection for a database image, and makes an HTTP request
  otherwise.
- **From its hostname**: the public hostname Traefik publishes
  (`<slug>.<base domain>` or the custom domain). It's skipped for a service that
  isn't DNS-resolvable, and while the base domain is a loopback address like
  `localhost`, since probing it from this machine proves nothing.

A probe that changes from up to down, or back, fires the **Service down** or
**Service recovered** event on any
[notification channel](operations.md#notifications) subscribed to it. Results
are kept for a week; **Clear heartbeats** empties the history. Uptime also feeds
[status pages](operations.md#status-pages).

Probing is on for every service by default. **Turn off** in the Uptime panel's
header stops both probes for that service (the panel then says so), **Turn on**
resumes them; the REST API takes the same switch as `uptimeEnabled` on
`PATCH /api/v1/services/:id`.

### Logs

The log panel live-streams a running container's stdout/stderr straight from the
browser: the server pushes each line as the container writes it over a long-
lived HTTP response, no polling and no WebSocket (SvelteKit 2 has no WebSocket
route API; nothing here needs a client-to-server socket anyway). A shorter tail
of the same viewer is on the Overview tab once a service has deployed at least
once, so recent output is visible without switching tabs.

## Terminal

An interactive `/bin/sh` into the live container, from the browser, only
available while the service is `running`. Open/close events are logged;
individual keystrokes/commands are not (that's a deliberate scope cut, not an
oversight, raw TTY bytes don't map cleanly to discrete commands anyway).

## Scheduled redeploy

Off by default, per service, the Settings tab's `cronEnabled` checkbox + a
standard 5-field cron schedule. Useful for an image tracking `:latest`, or a
git-mode service you want rebuilt on a schedule rather than manually. A due
schedule queues a deploy like any other trigger, so a redeploy that's still
waiting its turn is never queued twice.

## Cron jobs

**Cron Jobs** in the sidebar is the other half of scheduling: a task on a
schedule that isn't tied to a service. Each job runs one of two ways:

- **Container**: an image (plus optional tag, command override, env vars, and
  private-registry credentials) run as a throwaway container. Homerun pulls the
  image if it's missing, runs it to completion, keeps its stdout/stderr, and
  removes the container.
- **Host command**: a shell command run through `sh -c` on the Docker host
  itself, not inside Homerun's container: a throwaway privileged `alpine:3`
  helper sharing the host's PID namespace uses `nsenter` to step into the host's
  own namespaces, so the command sees the host's filesystem, network and
  processes as root. Only the job's own env vars are set. **Admin-only**. With
  rootless Docker "the host" is the rootless daemon's own namespace, and with
  Docker Desktop or OrbStack it's their Linux VM, not your Mac.

Give it a 5-field cron schedule, a timeout (default 900s, the job is killed past
it), and turn the schedule on or off without deleting the job. Runs go through
the same [job queue](#the-job-queue) as deploys and backups, so **Run now**
returns immediately and one job never runs twice concurrently. Each run's exit
code and captured output are kept on the job's page, and enabled jobs also show
up on the Scheduling page next to cron redeploys and backups.

### Errors

Below the logs, **Failed deployments** and **Application errors** (persisted
warn/error-level app log lines that mention this service) sit alongside a
"container currently down" banner when the container has crashed. A deploy that
reaches running hides the errors logged before it, and **Clear errors** does the
same by hand; a note says how many are hidden and what cleared them, with a link
to show them again. If a service's container was removed outside Homerun (e.g. a
manual `docker rm`), the tab shows a distinct "container is gone" banner with a
**Resolve** button instead: click it to clear the stale reference so the service
goes back to its normal never-deployed state and Deploy works again.

## Notifications

The bell in the header shows a per-account feed of lifecycle events for your
services, deploy succeeded or failed, a build stopped by failing status checks,
an unhealthy or rolled back revision, service created, started or stopped, an
auto-redeploy firing, an image scan finding a critical vulnerability, and
runtime errors. Click an entry to jump to its service. See
[Operations](operations.md#notifications) for how it differs from the
Observability tab's persisted error view, and for sending the same
build/update/deploy/uptime events out to Discord, Slack, Telegram, a generic
webhook, or email.

## Settings

Name, slug, restart policy, which stack the service belongs to, the
[scheduled redeploy](#scheduled-redeploy) above, the pull policy, whether its
image is [scanned](#image-scanning), [auto-rollback](#revisions-and-rollback),
and a danger-zone delete (typed-confirm, see
[The services list](#the-services-list)).

**Pull policy** decides whether a deploy pulls the image: **Always** (the
default, and the only way a moving tag like `:latest` picks up a new build),
**If missing** (only when the image isn't on the host yet, faster redeploys but
a moving tag goes stale), or **Never** (for an image built or loaded onto the
host by hand, the deploy fails if it isn't there).

**Healthcheck command** overrides the image's own Docker healthcheck with a
shell command run inside the container every 30s (exit 0 = healthy). When a
service has one, its uptime probe reports the healthcheck instead of knocking on
the container port, which is what a portless container like Newt needs: the Newt
template ships one that only passes while its Pangolin tunnel is connected.
Takes effect on the next deploy.

**Save as template** is here too: it snapshots this service's current image,
tag, port, env vars, resource limits, healthcheck and
[runtime options](#runtime) into a reusable template of your own, which then
behaves exactly like a built-in one, including being linkable as a companion to
another template. See [Stacks & templates](stacks-and-templates.md#templates).

## Next steps

- [Stacks & templates](stacks-and-templates.md)
- [Storage & backups](storage-and-backups.md)
- [Build servers & the Homerun Agent](remote-hosts-and-agent.md)
- [Operations & maintenance](operations.md)
