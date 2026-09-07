# Build servers & the Homerun Agent

Services always deploy to this host's own Docker daemon. Placement across
machines is [swarm mode](services.md#swarm-mode)'s job: a second machine joins
the swarm as a worker (`packages/installer/swarm-join.sh`) rather than being
registered separately.

A **remote host** is therefore a _build server_: somewhere a git-based service's
image gets built instead of on this machine, then published through a build
cache registry and pulled back here to run.

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

## A build server needs a cache registry

The built image only exists on the build server's own daemon, so a service with
a build server set also needs a **build cache registry**, a registry credential
registered under `/build-cache-registries` and picked on the service's
[Source tab](services.md#deploy-source-image-or-git-repo): the build pushes the
final image there and this host pulls it back before starting the container.
Saving a build server without one is rejected. The same registry doubles as the
layer cache, so a repeat build reuses what the last one pushed.

The `git clone` step always happens on the build server, alongside the build.

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

`packages/installer/` automates standing up a fresh Linux box with rootless
Docker plus either the Agent or the full stack, this is what
`docs/getting-started.md`'s one-liner runs. See
[`packages/installer/README.md`](../packages/installer/README.md) for flags and
what's verified.

A separate script, `packages/installer/swarm-join.sh`, joins a box to an
**existing** Docker Swarm as a worker (on its own rootless Docker daemon) and
installs the Homerun Agent there. This is how you add capacity: the swarm
scheduler places workloads on the new node automatically. Registering it as a
build server (above) is separate and only needed if you also want to build
there. Run it with the join token/manager address from
`docker swarm join-token worker` on your manager:

```sh
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/swarm-join.sh \
  | sudo bash -s -- --token <SWMTKN-...> --manager <ip>:2377
```

Unlike the main installer's `--mode=agent`/`--mode=full` (now verified live
against real disposable VMs, see
[`packages/installer/README.md`](../packages/installer/README.md)),
`swarm-join.sh` itself hasn't been run against a real second host or a real
swarm yet, same "verify on your own box first" caveat, just not yet closed the
way the rest of the installer's mutating steps were.
