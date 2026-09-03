# Homerun installer

Single-command server setup: Docker Engine, a dedicated **rootless** Docker
user, the `homerun`, and either the Homerun Agent or the full Homerun stack
(Traefik + Postgres + the app itself), entirely from prebuilt release binaries
and Docker images. Nothing is built from source, and neither Bun nor `git` need
to exist on the target host at any point.

## The one-liner

```bash
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/bootstrap.sh \
  | sudo bash -s -- --mode=full
```

`bootstrap.sh` is the actual entry point a `curl | bash` points at, it downloads
the `homerun-installer-<arch>` binary for the target host's architecture from
this repo's latest GitHub release and `exec`s it directly. Pin a specific
release instead of the newest one with `--version=vX.Y.Z` (forwarded through to
the installer binary itself, which also uses it to pick the matching
`homerun-agent-<arch>` binary, see below).

The one-liner serves `bootstrap.sh` straight from this repo on
`raw.githubusercontent.com`, so it only works while the repo is public. If it
isn't, download the release binary directly and run it instead:

```bash
curl -fsSL https://github.com/orochibraru/homerun/releases/latest/download/homerun-installer-amd64 -o homerun-installer
chmod +x homerun-installer
sudo ./homerun-installer --mode=full
```

## What it does

1. Installs Docker Engine (the official `get.docker.com` convenience script)
   plus `uidmap`/`dbus-user-session`, the host-level prerequisites rootless
   Docker's subuid/subgid mapping needs.
2. Creates a dedicated system user (`--user=`, default `homerun`) if one doesn't
   already exist.
3. Installs **rootless** Docker for that user via Docker's own documented flow
   (`get.docker.com/rootless` → `dockerd-rootless-setuptool.sh`), enables
   `loginctl enable-linger` so the daemon survives without an active login
   session, and starts it as a `systemd --user` service. Every container this
   installer (or the agent it installs) creates runs under this account's
   rootless permissions, never as root.
4. Creates the `homerun` Docker network on that rootless daemon.
5. `--mode=agent` (default): downloads the prebuilt `homerun-agent-<arch>`
   release binary straight to `/usr/local/bin/homerun-agent` and runs it as a
   `systemd --user` unit under the rootless account, pointed at the rootless
   socket. `--mode=full`: instead writes a standalone `compose.yaml` under
   `/home/<user>/homerun/` (Traefik + Postgres + the published
   `docker.io/orochibraru/homerun` app image, see `steps/full-stack.ts`) and
   runs `docker compose pull && ...up -d` against it under that same
   account/daemon. Either way, every artifact involved is something CI already
   published (see Release automation in the root `CLAUDE.md`), this installer's
   own job is wiring rootless Docker up and pulling the right thing into it, not
   building anything.

## Flags

See `--help`. Notable ones: `--version=` (a release tag like `v1.2.3`, default
`latest`), `--mode=agent|full`, `--user=` (rootless account name), `--port=`
(agent port), `--dry-run` (prints every command instead of running it, see
below), `--yes`/`-y` (no confirmation prompt, needed for a non-interactive
`curl | bash`).

`--mode=full` needs `AUTH_SECRET` set before the app container will start: the
generated `compose.yaml` fails closed on a missing one rather than booting with
an insecure default. Put it (and anything else you want to override,
`POSTGRES_PASSWORD`, `HOMERUN_BASE_DOMAIN`, `HOMERUN_ORIGIN`, `ACME_EMAIL`) in a
`.env` file next to that `compose.yaml`, then
`docker compose -f compose.yaml up -d` as the rootless user.

## Joining a host to a swarm (`swarm-join.sh`)

Separate one-off script, not part of the TypeScript installer above : joins this
host to an existing Docker Swarm as a worker (on its own rootless Docker daemon)
and installs the Homerun Agent as a `systemd --user` unit against that same
daemon. This is what makes a remote box usable once the main instance's
Settings > Orchestration is switched to `"swarm"` (see
`$lib/services/docker/swarm.ts`) : a swarm-mode service only schedules onto
nodes that are actually members of the swarm, plain Remote Hosts (a
separately-reachable Docker daemon) don't automatically become that.

Get the join token and manager address from the swarm manager itself first:

```bash
docker swarm join-token worker
```

Then, on the node you want to add:

```bash
curl -fsSL https://<wherever swarm-join.sh is hosted>/swarm-join.sh | sudo bash -s -- \
  --token <SWMTKN-...> --manager <manager-ip>:2377
```

Same "no hosted copy exists yet" caveat as `bootstrap.sh` above applies :
download `installer/swarm-join.sh` directly and run it with `sudo bash` until
it's hosted somewhere. `--user=` (default `homerun`) and `--version=` (agent
binary release tag, default `latest`) are both optional, same meaning as the
main installer's flags.

Deliberately a standalone bash script, not a mode of the TypeScript installer :
a narrower job (join + agent only, no `homerun`/compose-stack setup) that
doesn't need `StepRunner`'s dry-run machinery to stay readable. Mirrors
`steps/rootless-docker.ts` and `steps/agent.ts`'s exact command sequences by
hand so the two don't drift.

**Not verified against a real second host or a real swarm** (same "couldn't be
checked against something real in this environment" caveat as the rest of this
installer, see below) : `bash -n` syntax-checked and `shellcheck`-clean, and
every individual command mirrors a step already dry-run-verified in the main
installer, but the actual `docker swarm join` handshake and the resulting
Homerun deploy onto that node haven't been run end-to-end. Verify by hand
against a real disposable second box before relying on it.

## Building the installer itself to a binary

There's no separate `installer/package.json`: `agent/`, `cli/`, and `installer/`
all share the repo root's `bun install`/`node_modules`. From the repo root:

```bash
bun install
bun run installer/index.ts --help   # from source
bun run scripts/build-packages.ts amd64   # or arm64, cross-compiles all three (agent/cli/installer)
```

Output lands in `dist/homerun-installer-<arch>` (plus the agent/cli binaries
alongside it). CI does exactly this for every release
(`.github/workflows/binaries.yaml` + `.releaserc.json`'s GitHub-release assets):
building locally is only for iterating on the installer itself.

## What's verified vs. not

**Verified**: the full command sequence via `--dry-run` (every step's exact
command line, for both `--mode=agent` and `--mode=full`, including the generated
`compose.yaml` content), and that both the source (`bun run index.ts`) and the
compiled binary (`bun run build` → `./dist/homerun-install`) produce identical
dry-run output.

**Not verified, this is the one part of this feature that couldn't be checked
against something real**, same caveat as this codebase's Git Providers OAuth
flow: nothing in this session ran the real, mutating steps (package install,
`useradd`, rootless Docker setup, systemd units, or the downloaded
binaries/images actually starting) against an actual fresh Linux box, doing so
needs a disposable VM/CI runner this environment doesn't have. Built carefully
from Docker's own documented rootless-install steps and this repo's own release
artifacts rather than invented from scratch, but **run this by hand against a
real disposable server once, before trusting the one-liner on anything that
matters.** Particular things worth double-checking on that first real run: the
`XDG_RUNTIME_DIR`/`DOCKER_HOST` env threading through `sudo -u` (env_reset can
be subtle across distros), that `loginctl enable-linger` actually persists the
rootless daemon across a reboot, and that the generated `compose.yaml`'s
docker-socket bind mount (the rootless socket path, not `/var/run/docker.sock`)
actually lets the `app` container reach the daemon it's meant to manage.
