# Homerun Agent

A standalone binary that runs on a _remote_ host's own Docker daemon and exposes
a small, token-authenticated HTTP control surface, deploy, start, stop, restart,
logs, host stats, for the main Homerun instance to drive.

This exists as an alternative to registering a Remote Host by raw
`tcp://`/`ssh://` Docker socket: instead of exposing (or SSH-tunneling into) the
daemon itself, the remote host runs this agent and the main app only ever talks
to it over plain HTTP with a bearer token. It's the foundation piece for real
multi-host workload placement, see `CLAUDE.md`'s "Homerun Agents" section in the
main app for how it plugs in, and its own "draft, not finished" caveats.

## Running it

Four ways, roughly in order of how little you want to think about it. None of
them need Bun or a source checkout on the target host.

**Via the installer (recommended for a fresh host).** Sets up rootless Docker
too, not just the agent itself, see
[`installer/README.md`](../installer/README.md):

```bash
curl -fsSL https://git.ombrage.space/orochibraru/homerun/raw/branch/main/installer/bootstrap.sh \
  | sudo bash -s -- --mode=agent
```

**Already running Docker your own way?** Run the published image
(`git.ombrage.space/orochibraru/homerun-agent`, `linux/amd64` + `linux/arm64`,
built from [`agent/Dockerfile`](./Dockerfile) via the root `docker-bake.hcl`
convention, see [`agent/docker-bake.hcl`](./docker-bake.hcl)), mounting the
Docker socket the same way any Docker-managing container does:

```bash
docker run -d --name homerun-agent --restart unless-stopped \
  -p 7420:7420 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v homerun-agent-token:/root/.homerun-agent \
  git.ombrage.space/orochibraru/homerun-agent:latest
```

(The second volume persists the generated token across container restarts, same
as `tokenFile` does for a bare-binary install; set `AGENT_TOKEN` explicitly via
`-e` instead if you'd rather pin it yourself. Point
`-v /run/user/<uid>/docker.sock:/var/run/docker.sock` plus
`-e DOCKER_SOCKET_PATH=/var/run/docker.sock` at a rootless daemon instead of the
default system one.)

**Grab the prebuilt binary directly** from this repo's Gitea releases (Linux
amd64/arm64 only, same coverage as the CLI's binaries, see
`scripts/build-packages.ts`):

```bash
curl -fsSL https://git.ombrage.space/orochibraru/homerun/releases/latest/download/homerun-agent-amd64 -o homerun-agent
chmod +x homerun-agent
./homerun-agent
```

(`-arm64` instead of `-amd64` on an arm64 host.)

On first boot with no `AGENT_TOKEN` set, it generates one and prints it, copy
that (plus this host's reachable `http://host:7420`) into the main Homerun
instance's Remote Hosts page.

**Working on the agent itself, or want to run it from source:**

```bash
bun install                  # from the repo root, agent/ has no package.json of its own
bun run agent/index.ts       # or `bun --watch agent/index.ts` for autoreload
```

Compiling it to a standalone binary yourself, rather than using a release one:

```bash
bun run build                # host platform
bun run build:linux-x64      # cross-compile for a typical VPS
bun run build:linux-arm64
./dist/homerun-agent
```

## Env vars

| Var                    | Default                  | Meaning                                                                                                                                                                                                                              |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                 | `7420`                   | HTTP listen port                                                                                                                                                                                                                     |
| `AGENT_TOKEN`          | _(generated)_            | Bearer token every non-health request must present. Set this explicitly for a reproducible deploy (e.g. via the installer or a systemd unit); otherwise the agent generates one on first boot and persists it to `AGENT_TOKEN_FILE`. |
| `AGENT_TOKEN_FILE`     | `~/.homerun-agent/token` | Where a generated token is persisted across restarts.                                                                                                                                                                                |
| `DOCKER_SOCKET_PATH`   | `/var/run/docker.sock`   | Point this at a rootless Docker socket (e.g. `/run/user/<uid>/docker.sock`) when installed via `installer/`'s rootless setup.                                                                                                        |
| `HOMERUN_NETWORK_NAME` | `homerun-network`        | Created on boot if missing; every deployed container joins it (bridge mode only, host-mode services skip it, same as the main app).                                                                                                  |

## HTTP surface

Every route below requires `Authorization: Bearer <token>` except `/v1/health`.

- `GET /v1/health`, `{status, version}`, unauthenticated (for a load
  balancer/monitor probe).
- `GET /v1/stats`, host CPU/RAM/disk/GPU, same shape as the main app's
  `SystemStatsService`.
- `GET /v1/containers`, every `homerun.managed=true` container on this host (raw
  dockerode `ContainerInfo[]`).
- `POST /v1/deploy`, body is a `DeployInput` (see `src/docker.ts`): pulls the
  image, removes the previous container for that `serviceId` (found by label,
  not name), creates + starts the new one. Returns `{containerId, log}`.
- `GET /v1/containers/:id`, `{id, state, status}`.
- `DELETE /v1/containers/:id`, stop + remove.
- `POST /v1/containers/:id/{start,stop,restart}`.
- `GET /v1/containers/:id/logs?follow=true|false`, raw log bytes, streamed when
  `follow=true`.

## What's verified vs. not

Verified live in development against a real local Docker socket: boot + network
creation, every endpoint above (including a real `nginx:alpine` pull → create →
start → redeploy-replaces-old → stop/remove round trip), and the compiled binary
running standalone with the same behavior as `bun run dev`. **Not verified**:
running under a genuinely separate/remote host, under rootless Docker
specifically (the installer's rootless setup is new and untested end-to-end, see
`installer/README.md`), or long-running under a real systemd unit.
