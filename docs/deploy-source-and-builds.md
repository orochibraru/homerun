# Deploy source and build methods

Where a service's image comes from, how a git-based service is built, and which
machine builds it.

## Deploy source: image or git repo

Every service is either:

- **Bring-your-own-image** (the default), an image + tag, optionally with
  private registry credentials.
- **Build from a git repo**, Homerun clones the repo (shallow, by branch, tag or
  full 40-character commit SHA, which pins the service to that commit) and
  builds it locally with the service's **build method**. No registry involved:
  the build produces a fresh local image tag
  (`homerun-build-<slug>:<timestamp>`) every deploy.

## Build methods

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

## Build servers and build cache

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
