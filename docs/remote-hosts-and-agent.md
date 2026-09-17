# Build servers & the Homerun Agent

Services always deploy to this host's own Docker daemon. Placement across
machines is [swarm mode](services.md#swarm-mode)'s job: a second machine joins
the swarm as a worker (`packages/installer/swarm-join.sh`) rather than being
registered separately.

A **remote host** is therefore a _build server_: somewhere a git-based service's
image gets built instead of on this machine, then brought back here to run.

## Registering a build server

From `/remote-hosts`: a name, plus a connection type:

- **Direct Docker connection**: `tcp://host:port` (+ optional TLS client cert
  for a secured Docker API), or `ssh://user@host`, pointed at the target daemon
  directly.
- **Homerun Agent**: a URL + bearer token for a host running the standalone
  agent binary instead, see [Homerun Agent](#homerun-agent) below. The token is
  verified live against the agent before the host is saved. This is the
  lighter-weight alternative that doesn't require exposing the Docker daemon
  itself.

Either kind builds: a Docker-connection host runs the build through dockerode,
an agent host through its own `POST /v1/build`.

`/remote-hosts` has a search box and a Connection-type filter (Docker
socket/Homerun Agent) once you have more than a couple registered, plus a pager
if you have more than a page's worth, searched/paginated server-side.

## Getting the image back here

The built image only exists on the build server's own daemon, so it has to reach
this host before the container can start. Two ways, picked by whether the
service has a **build cache registry** (a registry credential registered under
`/build-cache-registries` and picked on the service's
[Source tab](services.md#deploy-source-image-or-git-repo)):

- **With a cache registry**, the build pushes the final image there and this
  host pulls it back. The same registry doubles as the layer cache, so a repeat
  build reuses what the last one pushed.
- **Without one**, the image is streamed straight from the build server into
  this host's daemon: `docker save` on the build server piped into `docker load`
  here, through the Docker connection itself or the agent's
  `GET /v1/images/save`. Nothing to set up, but every deploy transfers the whole
  image rather than only the layers that changed.

The `git clone` runs on the build server itself for both connection kinds (in a
throwaway `alpine/git` container on its daemon), so the repository has to be
reachable from the build server rather than from here. The build runs there too,
with BuildKit in a `docker:cli` helper container that mounts the build server's
`/var/run/docker.sock` (the agent uses its own `DOCKER_SOCKET_PATH`).

## Homerun Agent

A standalone binary (`packages/agent/`) meant to run on a build server's own
Docker daemon, exposing git builds and host stats over a small
token-authenticated HTTP API, the alternative to registering a build server by
raw `tcp://`/`ssh://` socket. Instead of exposing (or SSH-tunneling into) the
daemon itself, the build server runs this agent and the main app talks to it
over plain HTTP with a bearer token, this is what the "Homerun Agent" connection
type on `/remote-hosts` (above) registers.

```sh
bun install                      # from the repo root, packages/agent/ has no package.json of its own
bun run packages/agent/index.ts  # talks to /var/run/docker.sock by default
```

Or compiled to a standalone binary (no Bun runtime needed on the target host):
`bun run build:packages` (builds the CLI/installer/agent binaries for both
arches). On first boot with no `AGENT_TOKEN` set, it generates one and prints
it, copy that plus this host's reachable URL into `/remote-hosts`'s "new host"
form, see [`packages/agent/README.md`](../packages/agent/README.md) for the full
env var and HTTP surface reference, plus install options (a Docker image, a
prebuilt binary, or the installer below).

**Wired into the main app**: registering an agent-kind build server and picking
it on a git-based service's Source tab routes that service's builds through this
agent's HTTP API instead of a raw Docker connection.

## Installer

`packages/installer/` automates standing up a fresh Linux box with either the
full stack, on the system Docker daemon as a swarm manager (or on rootless
Docker in standalone mode with `--docker=rootless`), or the Agent alone, on its
own rootless daemon. This is what `docs/getting-started.md`'s one-liner runs,
and `--migrate-to-rootful` moves an older rootless install onto the system
daemon in swarm mode. See
[`packages/installer/README.md`](../packages/installer/README.md) for flags and
what's verified.

A separate script, `packages/installer/swarm-join.sh`, joins a box to an
**existing** Homerun swarm as a worker and installs the Homerun Agent there
(through the installer's `--mode=agent`). This is how you add capacity: the
swarm scheduler places workloads on the new node automatically. Registering it
as a build server (above) is separate and only needed if you also want to build
there. Run it with the join token/manager address from
`docker swarm join-token worker` on your manager:

```sh
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/swarm-join.sh \
  | sudo bash -s -- --token=<SWMTKN-...> --manager=<ip>:2377
```

The node joins on the **system (rootful)** Docker daemon, same as the manager
runs on (see [swarm mode](services.md#swarm-mode)): rootless Docker can't create
the overlay networks swarm services use. Nodes need to reach each other on
2377/tcp, 7946/tcp+udp and 4789/udp. On a host with several network interfaces
add `--advertise-addr=<ip>`. Verified against two real disposable VMs: the
worker joins, replicas get scheduled on it and Traefik on the manager serves
them over the overlay network.
