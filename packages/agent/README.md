# Homerun Agent

A standalone binary that runs on a _remote_ host's own Docker daemon and exposes
a small, token-authenticated HTTP control surface, git builds and host stats,
for the main Homerun instance to drive.

This exists as an alternative to registering a build server by raw
`tcp://`/`ssh://` Docker socket: instead of exposing (or SSH-tunneling into) the
daemon itself, the build server runs this agent and the main app only ever talks
to it over plain HTTP with a bearer token. It's wired into the main app as a
build-server connection kind (`remote_host.kind: "agent"`), see
[`docs/remote-hosts-and-agent.md`](../../docs/remote-hosts-and-agent.md) for how
it plugs in.

## Running it

Four ways, roughly in order of how little you want to think about it. None of
them need Bun or a source checkout on the target host.

**Via the installer (recommended for a fresh host).** Sets up rootless Docker
too, not just the agent itself, see
[`packages/installer/README.md`](../installer/README.md):

```bash
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/bootstrap.sh \
  | sudo bash -s -- --mode=agent
```

**Already running Docker your own way?** Run the published image
(`docker.io/orochibraru/homerun-agent`, `linux/amd64` + `linux/arm64`, built
from the `agent` stage in the root [`Dockerfile`](../../Dockerfile) via the
`agent` target in the root [`docker-bake.hcl`](../../docker-bake.hcl)), mounting
the Docker socket the same way any Docker-managing container does:

```bash
docker run -d --name homerun-agent --restart unless-stopped \
  -p 7420:7420 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v homerun-agent-token:/root/.homerun-agent \
  docker.io/orochibraru/homerun-agent:latest
```

(The second volume persists the generated token across container restarts, same
as `tokenFile` does for a bare-binary install; set `AGENT_TOKEN` explicitly via
`-e` instead if you'd rather pin it yourself. Point
`-v /run/user/<uid>/docker.sock:/var/run/docker.sock` plus
`-e DOCKER_SOCKET_PATH=/var/run/docker.sock` at a rootless daemon instead of the
default system one.)

**Grab the prebuilt binary directly** from this repo's GitHub releases (Linux
and macOS, amd64/arm64, same coverage as the CLI's binaries, see
`scripts/build-packages.ts`):

```bash
curl -fsSL https://github.com/orochibraru/homerun/releases/latest/download/homerun-agent-amd64 -o homerun-agent
chmod +x homerun-agent
./homerun-agent
```

(`-arm64` instead of `-amd64` on an arm64 host, `-darwin-amd64`/`-darwin-arm64`
on macOS.)

On first boot with no `AGENT_TOKEN` set, it generates one and prints it, copy
that (plus this host's reachable `http://host:7420`) into the main Homerun
instance's Remote Hosts page.

**Working on the agent itself, or want to run it from source:**

```bash
bun install                          # from the repo root, packages/agent/ has no package.json of its own
bun run packages/agent/index.ts      # or `bun --watch packages/agent/index.ts` for autoreload
```

Compiling it to a standalone binary yourself, rather than using a release one:

```bash
bun run build:packages       # builds cli/installer/agent binaries for every target, cli/agent also for macOS
./dist/homerun-agent-amd64   # or -arm64
```

## Env vars

| Var                      | Default                  | Meaning                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `7420`                   | HTTP listen port                                                                                                                                                                                                                                                                                                 |
| `AGENT_TOKEN`            | _(generated)_            | Bearer token every non-health request must present. Set this explicitly for a reproducible deploy (e.g. via the installer or a systemd unit); otherwise the agent generates one on first boot and persists it to `AGENT_TOKEN_FILE`.                                                                             |
| `AGENT_TOKEN_FILE`       | `~/.homerun-agent/token` | Where a generated token is persisted across restarts.                                                                                                                                                                                                                                                            |
| `DOCKER_SOCKET_PATH`     | _(detected)_             | Point this at a rootless Docker socket (e.g. `/run/user/<uid>/docker.sock`) when installed via `packages/installer/`'s rootless setup. Unset, it uses a `unix://` `DOCKER_HOST`, then the `docker` CLI's current context, then the first common socket path that exists, falling back to `/var/run/docker.sock`. |
| `AGENT_SHUTDOWN_TIMEOUT` | `120`                    | Seconds SIGINT/SIGTERM waits for in-flight requests (a `/v1/build` clone+build in progress) to finish before forcing the shutdown.                                                                                                                                                                               |

## HTTP surface

Every route below requires `Authorization: Bearer <token>` except `/v1/health`
and `/v1/openapi.json`.

- `GET /v1/health`, `{status, version}`, unauthenticated (for a load
  balancer/monitor probe).
- `GET /v1/openapi.json`, the agent's own OpenAPI document, unauthenticated.
- `GET /v1/stats`, host CPU/RAM/disk/GPU, same shape as the main app's
  `SystemStatsService`.
- `POST /v1/build`, body is a `BuildInput` (see `schemas.ts`): clones a git repo
  at a ref (a branch, tag or full commit SHA) and builds it into a local image
  with `buildMethod`: `dockerfile` (the default, `docker buildx build` with
  BuildKit), `bake` (`docker buildx bake`, one target of `bakeFile`, default
  `docker-bake.hcl`, `bakeTarget`, default `default`), or `nixpacks`,
  `railpack`, `heroku`, `paketo`. Every method runs in a pinned `docker:cli`
  helper container with the agent's Docker socket mounted, see `builders.ts`.
  With `push`, the BuildKit layer cache is read from and written to that
  registry (`<registry>/<image>:buildcache`) and the image is pushed there
  afterward. A `commit` pins the build to that commit even when the branch has
  moved on, which is how the main app keeps a build on the commit whose required
  status checks passed. Returns `{success, commit?, error?}`, where a failed
  build's `error` carries its most telling output line. An agent older than this
  ignores `commit` and builds the branch head.
- `GET /v1/images/save?ref=<image:tag>`, streams a local image as a
  `docker save` tarball (`application/x-tar`, 404 when the image isn't there).
  The main app `docker load`s it when a build server has no cache registry.
  **Not verified live** against a real agent yet.

## What's verified vs. not

Verified live in development against a real local Docker socket: boot, every
endpoint above except `/v1/images/save`, and the compiled binary running
standalone with the same behavior as `bun run dev`.

**Also now verified**, against a real disposable Multipass Ubuntu 24.04 VM
provisioned by `packages/installer/bootstrap.sh --mode=agent` (see
`packages/installer/README.md` for that run's own findings): running under
rootless Docker specifically, long-running under a real `systemd --user` unit,
reachable over the network from outside the VM (health endpoint + OpenAPI doc
both responded correctly).
