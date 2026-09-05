# Remote hosts & the Homerun Agent

A service deploys to the local Docker socket by default. Registering a **remote
host** and picking it as a service's deploy target (Settings tab) routes every
Docker operation for that service, deploy, start/stop/restart, logs, status
sync, at a different daemon instead.

## Registering a remote host

From `/remote-hosts`: a name, plus a connection type:

- **Direct Docker connection**: `tcp://host:port` (+ optional TLS client cert
  for a secured Docker API), or `ssh://user@host`, pointed at the target daemon
  directly.
- **Homerun Agent**: a URL + bearer token for a host running the standalone
  agent binary instead, see [Homerun Agent](#homerun-agent) below. The token is
  verified live against the agent before the host is saved. This is the
  lighter-weight alternative that doesn't require exposing the Docker daemon
  itself.

Either kind is a real, selectable deploy target and (opt-in, per host) build
server; deploy/start/stop/restart/logs all route through whichever one a host is
registered as.

`/remote-hosts` has a search box and a Connection-type filter (Docker
socket/Homerun Agent) once you have more than a couple registered, plus a pager
if you have more than a page's worth, searched/paginated server-side.

## Real limitations, not oversights

The shared `homerun`, per-project networks, and Traefik itself all live on the
**local** host. A remote-hosted container gets Docker's own default `bridge`
network instead, no Traefik routing, no `<slug>` DNS alias, no project-network
membership. It's reachable only however you arrange that yourself; there's
deliberately no host-port-publishing UI for remote services either. **Bind-mount
volumes are skipped entirely** on a remote deploy (a local path has no meaning
on a different machine), Docker-managed volumes still work, since Docker
resolves those by name against whichever daemon it's pointed at.

Git-based builds work against a remote host too (the build step streams to
whichever daemon the client points at), but the `git clone` step itself always
happens locally first.

## Autoscaling / load-based migration

**This is scoped-down "Cloud Run-like" load shedding, not elastic replica
autoscaling.** Real replica scaling now exists as a separate feature, see
[Services: swarm mode](services.md#swarm-mode), but this scheduler doesn't drive
it and isn't swarm-aware: don't mark a swarm-mode service autoscale-eligible,
migrating one to a remote host isn't supported (see below). What autoscaling
does instead: when the local host crosses a configured resource threshold,
**migrate** one opted-in standalone-mode service onto a designated overflow
remote host (stop/remove the local container, deploy fresh on the remote one),
not replicate it.

Two-level opt-in, both required:

1. **Instance-wide** (`/settings` → Autoscaling): enabled + CPU/memory
   thresholds (default 80%) + which remote host absorbs the overflow.
2. **Per-service** (Compute tab): the `autoscaleEligible` toggle.

A background scheduler checks host stats every tick; if a threshold is crossed,
it migrates exactly one eligible local service and re-checks next tick rather
than moving several at once for a single reading. The overflow host must be
owned by the same account as the migrating service, a mismatch is a safe no-op
(logged), not a cross-account leak.

## Homerun Agent

A standalone binary (`packages/agent/`) meant to run on a remote host's own
Docker daemon, exposing deploy/start/stop/restart/logs/stats (plus building from
a git repo) over a small token-authenticated HTTP API, the alternative to
registering a remote host by raw `tcp://`/`ssh://` socket. Instead of exposing
(or SSH-tunneling into) the daemon itself, the remote host runs this agent and
the main app talks to it over plain HTTP with a bearer token, this is what the
"Homerun Agent" connection type on `/remote-hosts` (above) registers.

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

**Wired into the main app**: registering an agent-kind Remote Host and picking
it as a service's deploy target (or build server) routes deploy/start/stop/
restart/logs through this agent's HTTP API instead of a raw Docker connection.
Verified live against a real, actually-separate second host (not just the agent
binary's own endpoints in isolation): two disposable VMs, one running
`--mode=agent`, the other running `--mode=full`, the full-stack VM's dashboard
registered the agent VM as a Remote Host and deployed a real service through it,
confirmed landing on the agent VM by `docker ps`, with stop/start round-tripping
successfully too.

## Installer

`packages/installer/` automates standing up a fresh Linux box with rootless
Docker plus either the Agent or the full stack, this is what
`docs/getting-started.md`'s one-liner runs. See
[`packages/installer/README.md`](../packages/installer/README.md) for flags and
what's verified.

A separate script, `packages/installer/swarm-join.sh`, joins a box to an
**existing** Docker Swarm as a worker (on its own rootless Docker daemon) and
installs the Homerun Agent there, groundwork for
[swarm mode](services.md#swarm-mode) eventually supporting remote nodes. Joining
the swarm this way doesn't by itself register the box as a Remote Host, you'd
still add it separately (agent connection type, above) to actually target it.
Run it with the join token/manager address from `docker swarm join-token worker`
on your manager:

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
