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
an insecure default (the installer itself generates this automatically into
`.env`, this only matters if running the compose file standalone, outside the
installer). Put it (and anything else you want to override, `POSTGRES_PASSWORD`,
`ORIGIN`, `ACME_EMAIL`) in a `.env` file next to that `compose.yaml`, then
`docker compose -f compose.yaml up -d` as the rootless user. `ORIGIN` matters
once you're reachable at a real domain, not just the install-time default of
`http://localhost:3000`, real, tested-live finding: without it, absolute URLs
this app constructs (e.g. the CLI login flow's own approval link) silently fall
back to `localhost` regardless of where the instance is actually reachable, see
`steps/full-stack.ts`'s own docstring. Base domain itself isn't `.env`-driven,
it's set on first boot by the onboarding wizard (or by hand afterward in
`homerun.yaml` next to `compose.yaml`, or on `/settings`).

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
download `packages/installer/swarm-join.sh` directly and run it with `sudo bash`
until it's hosted somewhere. `--user=` (default `homerun`) and `--version=`
(agent binary release tag, default `latest`) are both optional, same meaning as
the main installer's flags.

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

There's no separate `packages/installer/package.json`: `packages/agent/`,
`packages/cli/`, and `packages/installer/` all share the repo root's
`bun install`/`node_modules`. From the repo root:

```bash
bun install
bun run packages/installer/index.ts --help   # from source
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

**The real, mutating steps are now verified too**, against two real disposable
Multipass Ubuntu 24.04 VMs (superseding this section's earlier "needs a
disposable VM/CI runner this environment doesn't have" note):

- `--mode=agent` end to end on one VM: real `apt`/Docker Engine install, real
  rootless Docker setup, real `systemd --user` unit, and the Agent actually
  running and reachable over the network afterward (its health endpoint and
  OpenAPI doc both responded correctly from outside the VM).
- `--mode=full` end to end on a second VM: real rootless Docker, real
  `docker compose pull && ...up -d` bringing up Traefik + Postgres + the real
  published `docker.io/orochibraru/homerun` app image, all reporting healthy,
  dashboard reachable from outside the VM on port 3000.
- The two VMs together, closing a gap the main repo's `CLAUDE.md` (Remote hosts
  section) used to flag: the `--mode=full` VM's dashboard registered the
  `--mode=agent` VM as a real `agent`-kind Remote Host, token-verified live,
  then deployed a real `nginx:alpine` service through it, confirmed via
  `docker ps` that the container landed on the agent VM (not locally), and
  round-tripped stop/start through the agent successfully.

This run found and fixed five real bugs, all in
`packages/installer/steps/rootless-docker.ts` and `.../steps/full-stack.ts` (see
each file's own doc comments for the full detail):

1. Ubuntu 23.10+ (including 24.04) restricts unprivileged user namespaces by
   default, which broke `dockerd-rootless-setuptool.sh` outright
   (`rootlesskit: fork/exec /proc/self/exe: permission denied`). Fixed by
   writing the AppArmor profile Docker's own rootless installer suggests before
   attempting the rootless install.
2. Reading that same sysctl via `Bun.file(path).exists()`/`.text()` silently
   returned `""` instead of the real value — `/proc` pseudo-files report a
   0-byte size via `stat`, which appears to fool Bun's file reader, while
   `node:fs/promises`' `readFile` reads them correctly. Fixed by switching to
   `readFile`. Same class of Bun-vs-`node:fs` quirk as the already-documented
   `Bun.write` mode-option bug in the root `CLAUDE.md`.
3. Rootless Docker's port driver can't bind ports below 1024 by default (a
   Linux/rootless constraint, not a Docker bug), so Traefik's `80:80`/`443:443`
   publish failed with a permission error and `--mode=full` could never actually
   bring the stack up. Fixed via Docker's own documented fix, lowering
   `net.ipv4.ip_unprivileged_port_start`.
4. The generated `compose.yaml`'s `AUTH_SECRET` default-value error message
   contained an unquoted " : ", which `docker compose`'s YAML parser reads as a
   nested mapping key, not plain text, and failed to parse the file at all.
   Fixed by quoting the whole `${...}` expression.
5. The postgres service's volume mount used the pre-18 path
   (`/var/lib/postgresql/data`); the `postgres:18-alpine` image refuses to start
   against that path and wants a mount at the `/var/lib/postgresql` parent
   instead. Fixed to match, and to match this repo's own root
   `tools/compose/base.compose.yaml`, which already had this right.
6. The generated compose file never set `ORIGIN` for the app container, so
   absolute URLs it constructs (e.g. the CLI login flow's own approval link)
   silently fell back to `http://localhost:3000` regardless of the instance's
   real reachable address. Fixed by adding an overridable `ORIGIN` default, see
   the Flags section above.

**Still not verified**: `swarm-join.sh` (see its own section above), this VM
testing round didn't touch it. Particular things worth double-checking on a
future real run: the `XDG_RUNTIME_DIR`/`DOCKER_HOST` env threading through
`sudo -u` (env_reset can be subtle across distros), and that
`loginctl enable-linger` actually persists the rootless daemon across a real
reboot (not exercised this round, the VMs weren't rebooted).

This whole run is scripted and reproducible, not a one-off: from the repo root,
`bun run e2e:multipass` (`scripts/e2e-multipass.ts`) builds these binaries from
local source, launches two disposable Multipass VMs, runs both modes for real,
and drives the Remote Host + CLI checks above end to end, tearing down after
(`--keep` to leave the VMs up for inspection, `--skip-build` to reuse a previous
build). Requires Multipass + Docker locally; deliberately not run in CI (no
nested virtualization there).

`bun run e2e:multipass:release` (`scripts/e2e-multipass-release.ts`) is the
release-side counterpart: instead of local binaries, it runs the documented
`curl | sudo bash` one-liners themselves, read straight out of
`docs/getting-started.md` and `packages/agent/README.md` at run time and
executed verbatim, against a real published release (asserting first that the
release actually shipped all six binaries). Use it after cutting a release, or
after changing anything in those install instructions, and `--only=docs` on its
own for a fast, VM-free check that every place documenting the same command
still agrees (that phase also verifies each documented
`raw.githubusercontent.com` URL exists in the checkout and is live). Same CI
caveat.
