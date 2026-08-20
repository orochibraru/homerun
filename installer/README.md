# Homerun installer

Single-command server setup: Docker Engine, a dedicated **rootless** Docker
user, the `homerun-network`, and either the Homerun Agent or the full
Homerun stack (Traefik + Postgres + the app itself, via the repo's own
`compose.yaml`).

## The one-liner

```
curl -fsSL https://<wherever bootstrap.sh is hosted>/install.sh | sudo bash -s -- --repo=https://github.com/you/homerun.git
```

`bootstrap.sh` is the actual entry point a `curl | bash` points at — it
installs Bun if missing, clones the repo, and runs the real installer
(`installer/src/index.ts`) from that checkout. **There's no hosted copy of
this script yet** (no CI/release pipeline in this repo) — host `bootstrap.sh`
somewhere reachable (a gist, GitHub raw, your own site) before the one-liner
above is real, or run it locally on the target server instead:

```
git clone --depth 1 https://github.com/you/homerun.git
cd homerun/installer && bun install
sudo bun run src/index.ts --repo=https://github.com/you/homerun.git
```

## What it does

1. Installs Docker Engine (the official `get.docker.com` convenience
   script) plus `uidmap`/`dbus-user-session`, the host-level prerequisites
   rootless Docker's subuid/subgid mapping needs.
2. Creates a dedicated system user (`--user=`, default `homerun`) if one
   doesn't already exist.
3. Installs **rootless** Docker for that user via Docker's own documented
   flow (`get.docker.com/rootless` → `dockerd-rootless-setuptool.sh`),
   enables `loginctl enable-linger` so the daemon survives without an
   active login session, and starts it as a `systemd --user` service.
   Every container this installer (or the agent it installs) creates runs
   under this account's rootless permissions — never as root.
4. Creates the `homerun-network` Docker network on that rootless daemon.
5. Installs Bun (if missing) and clones `--repo=`/`--ref=` to build from
   source — there's no prebuilt-binary release feed yet, see below.
6. `--mode=agent` (default): builds `agent/`, installs the compiled binary
   to `/usr/local/bin/homerun-agent`, and runs it as a `systemd --user`
   unit under the rootless account, pointed at the rootless socket.
   `--mode=full`: instead runs `docker compose up -d` against the repo's
   own `compose.yaml` under that same account/daemon — the whole app,
   Traefik and Postgres included.

## Flags

See `--help`. Notable ones: `--repo=` (required), `--ref=` (branch/tag,
default `main`), `--mode=agent|full`, `--user=` (rootless account name),
`--port=` (agent port), `--dry-run` (prints every command instead of
running it — see below), `--yes`/`-y` (no confirmation prompt, needed for
a non-interactive `curl | bash`).

## Building the installer itself to a binary

```
bun install
bun run build                 # host platform
bun run build:linux-x64
bun run build:linux-arm64
```

Once a real release pipeline exists, `bootstrap.sh` should download the
right `homerun-install-<arch>` binary for the target box and `exec` it
directly instead of cloning + running via `bun run` — faster and doesn't
need Bun on the target host at all before the installer itself runs.

## What's verified vs. not

**Verified**: the full command sequence via `--dry-run` (every step's exact
command line, for both `--mode=agent` and `--mode=full`), and that both the
source (`bun run src/index.ts`) and the compiled binary (`bun run build` →
`./dist/homerun-install`) produce identical dry-run output.

**Not verified — this is the one part of this feature that couldn't be
checked against something real**, same caveat as this codebase's Git
Providers OAuth flow: nothing in this session ran the real, mutating steps
(package install, `useradd`, rootless Docker setup, systemd units) against
an actual fresh Linux box — doing so would mean installing Docker and
creating a system user on a real machine, which needs a disposable VM/CI
runner this environment doesn't have. Built carefully from Docker's own
documented rootless-install steps rather than invented from scratch, but
**run this by hand against a real disposable server once, before trusting
the one-liner on anything that matters.** Particular things worth
double-checking on that first real run: the `XDG_RUNTIME_DIR`/`DOCKER_HOST`
env threading through `sudo -u` (env_reset can be subtle across distros),
and that `loginctl enable-linger` actually persists the rootless daemon
across a reboot, not just across the install session.
