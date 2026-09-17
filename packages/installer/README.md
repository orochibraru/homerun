# Homerun installer

Single-command server setup: Docker Engine, a dedicated `homerun` user, the
Docker networks, and either the Homerun Agent or the full Homerun stack
(Traefik + Postgres + the app itself), entirely from prebuilt release binaries
and Docker images. Nothing is built from source, and neither Bun nor `git` need
to exist on the target host at any point. The full stack runs on the **system
(rootful)** Docker daemon as a swarm manager by default, so the instance starts
in swarm mode; `--docker=rootless` keeps the older rootless, standalone-only
setup, and `--migrate-to-rootful` moves such an install over.

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

Which distros this runs on (Ubuntu 24.04 and 26.04 tested, other apt distros
expected to work, dnf/yum best effort, Alpine and non-systemd hosts unsupported)
is documented in
[`docs/getting-started.md`](../../docs/getting-started.md#supported-systems).

## What it does

`--mode=full` (the default daemon, `--docker=rootful`):

1. Installs Docker Engine (the official `get.docker.com` convenience script) and
   enables the system daemon (`systemctl enable --now docker`).
2. Creates a dedicated system user (`--user=`, default `homerun`) if one doesn't
   already exist; it owns `/home/<user>/homerun/`, where the compose files live.
3. Makes the daemon a swarm manager: `docker swarm init --advertise-addr <ip>`,
   the address being `--advertise-addr=` or the source address of the host's
   default route (passed explicitly because `docker swarm init` refuses to guess
   on a host with several interfaces, "could not choose an IP address to
   advertise"). A host that's already a manager is left alone, a worker in
   another swarm is refused.
4. Creates the `homerun` bridge network (the app, Postgres, Traefik and
   standalone containers) and the attachable `homerun-swarm` overlay, the same
   name and shape the app's own `ensureSwarmNetwork` uses
   (`<networkName>-swarm`), so Traefik's compose container can join it.
5. Writes `compose.yaml` under `/home/<user>/homerun/` (see
   `steps/full-stack.ts`) and runs `docker compose pull && ...up -d` as root.
   Traefik mounts `/var/run/docker.sock`, joins both networks and runs both
   providers, its command ending in exactly the `--providers.swarm=true`,
   `--providers.swarm.exposedByDefault=false`,
   `--providers.swarm.network=homerun-swarm`,
   `--providers.swarm.refreshSeconds=2` flags the app's `enableSwarmMode`
   applies, so the app's boot-time check finds nothing to change and never
   recreates Traefik. The app gets `DOCKER_SOCKET_PATH: /var/run/docker.sock`.

The app picks swarm mode on its own the first time it boots against a fresh
database on a rootful swarm manager (see `OrchestrationService.applyOnBoot`);
nothing is seeded by the installer, and an existing database keeps its mode.

The trade-off: the Docker daemon runs as root, so anything that reaches its
socket, the app included, is root on the host.

`--docker=rootless` (`--mode=full`) and `--mode=agent`:

1. Installs Docker Engine plus `uidmap`/`dbus-user-session`, the host-level
   prerequisites rootless Docker's subuid/subgid mapping needs.
2. Creates the dedicated user.
3. Installs **rootless** Docker for that user via Docker's own documented flow
   (`get.docker.com/rootless` → `dockerd-rootless-setuptool.sh`), enables
   `loginctl enable-linger` so the daemon survives without an active login
   session, and starts it as a `systemd --user` service. Every container runs
   under this account's rootless permissions, never as root.
4. Creates the `homerun` Docker network on that rootless daemon.
5. `--mode=agent` (the default mode): downloads the prebuilt
   `homerun-agent-<arch>` release binary straight to
   `/usr/local/bin/homerun-agent` and runs it as a `systemd --user` unit under
   the rootless account, pointed at the rootless socket. The agent always gets a
   rootless daemon, `--docker=` doesn't apply to it.
   `--mode=full --docker=rootless`: writes the same compose file without the
   swarm provider or the overlay, pointed at the rootless socket, and runs
   compose as that user. The app starts in standalone mode there, and Settings →
   Docker shows swarm as unavailable with the reason.

Either way, every artifact involved is something CI already published (see
Release automation in `.agents/notes/packages-and-release.md`); this installer's
own job is wiring Docker up and pulling the right thing into it, not building
anything.

## Flags

See `--help`. Notable ones: `--version=` (a release tag like `v1.2.3`, default
`latest`), `--mode=agent|full`, `--domain=` (the domain or IP this instance is
reached at, see below), `--docker=rootful|rootless` (`--mode=full` only, default
`rootful`), `--advertise-addr=` (rootful only), `--migrate-to-rootful` (see
below), `--image=` (run another app image, e.g. a locally loaded build; its pull
failing is tolerated), `--user=` (install account name), `--port=` (agent port),
`--dry-run` (prints every command instead of running it, see below),
`--yes`/`-y` (no confirmation prompt, needed for a non-interactive
`curl | bash`).

Why rootful is the default: [swarm mode](../../docs/swarm-mode.md) can't run on
rootless Docker. Verified live on a Multipass VM: on a rootless install,
switching to Swarm left the daemon failing the overlay attach with "context
deadline exceeded" and the task with
`mkdir /var/lib/docker/network: permission denied`; the same stack on the system
daemon initialised the swarm, attached Traefik and served replicas from a second
node. The dashboard refuses Swarm up front on a rootless daemon.

## Migrating a rootless install (`--migrate-to-rootful`)

```bash
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/bootstrap.sh \
  | sudo bash -s -- --migrate-to-rootful --yes
```

For a `--mode=full` install made rootless (the default before swarm was),
`steps/migrate-rootful.ts`:

1. Enables the system daemon (installing Docker Engine if it's missing).
2. Starts the rootless daemon if it isn't running, records what's on it, and
   stops every running container (the stack, every service, the registry mirror,
   anything else).
3. Copies every named volume (anonymous ones are skipped) to a same-named volume
   on the system daemon, labels and driver options included so compose still
   owns its own. Data streams through `tar --numeric-owner` in an `alpine:3`
   container on each side, so ownership is what the containers saw (Postgres'
   uid 70 stays 70), not the subuid it was stored under on disk. A `local`
   volume with a `device` option is recreated without copying.
4. Makes the system daemon a swarm manager and creates both networks.
5. Keeps the old compose file as `compose.rootless.yaml`, points
   `homerun.yaml`'s `socketPath` at `/var/run/docker.sock`, and writes and
   starts the rootful + swarm compose file. `.env` is kept as is. The address
   comes from `--domain=`, else the old compose file's `ORIGIN` default, else
   `homerun.yaml`'s `baseDomain`, else detection.
6. Waits for the app, then in Postgres sets `orchestration_mode = 'swarm'`,
   `pending_service_redeploy = true` and clears a `/run/user/...` socket
   override, and restarts the app. On boot the app queues a redeploy of every
   deployed service under the first admin, and they come back as swarm services.
7. Disables the rootless daemon (`systemctl --user disable --now docker`),
   leaving its data in `~homerun/.local/share/docker`, and prints the commands
   that remove it, the containers it didn't move (not the stack, not a Homerun
   service) and the host paths services bind-mount (their files keep the
   ownership the subuid mapping gave them).

**Verified** on disposable Multipass Ubuntu 24.04 VMs
(`bun run e2e:multipass --fresh-swarm --migrate --local-image`): a default
`--mode=full` install booted in swarm mode with no settings change and Traefik
served a 2-replica service from both replicas; a real v1.0.26 rootless install
with an nginx service whose named volume held a marker file (uid 101) was
migrated, after which the admin user and service rows were intact, the instance
was in swarm mode, the service had been redeployed as a swarm service on its
own, the marker was still owned by 101:101 and served through Traefik, and the
rootless daemon was stopped. A second run of the same command skipped every
finished step and left the running service alone. That run found that every
swarm mount used to be `Type: bind`, so a service with a named volume couldn't
deploy in swarm mode at all (fixed in the app's `swarmMount`).

Re-running after a failure is safe: `/home/<user>/homerun/.rootful-migration/`
records the volume list, each finished copy and the instance switch, and a
re-run redoes only what's missing (a half-copied volume is removed and copied
again, the redeploy is never queued twice).

`--mode=full` needs to know **where this instance will be reached**, and it is
never allowed to be `localhost`. `--domain=` sets it outright (a full URL is
accepted, the scheme and trailing slash are stripped); with the flag omitted the
installer asks, offering this host's own address (the source IP of its route out
to the internet, else `hostname -I`) as the blank-answer default. A
`curl | bash` install has no TTY on stdin, so it takes that detected address
silently rather than hanging on a prompt nobody can answer. Whatever it lands on
becomes `baseDomain` in the generated `homerun.yaml` and the `ORIGIN` default in
the generated `compose.yaml`, and is printed at the end as the dashboard URL.

`--mode=full` needs `AUTH_SECRET` set before the app container will start: the
generated `compose.yaml` fails closed on a missing one rather than booting with
an insecure default (the installer itself generates this automatically into
`.env`, this only matters if running the compose file standalone, outside the
installer). Put it (and anything else you want to override, `POSTGRES_PASSWORD`,
`ORIGIN`, `ACME_EMAIL`) in a `.env` file next to that `compose.yaml`, then
`sudo docker compose -f compose.yaml up -d` (as the rootless user with its
`DOCKER_HOST` on a `--docker=rootless` install). Set `ORIGIN` there if the
instance moves to another address after install (the compose file's own default
is whatever `--domain=`/detection resolved to). Getting it wrong is not
cosmetic, real, reported finding: better-auth's trusted origins are derived from
`ORIGIN` alone, so a stale one makes every sign-in and the very first sign-up
403 with "Invalid origin" from the address you are actually using, and absolute
URLs this app constructs (e.g. the CLI login flow's own approval link) point at
the wrong host too. See `steps/full-stack.ts`'s own docstring. Base domain is
seeded from the same answer, and is still editable afterward in `homerun.yaml`
next to `compose.yaml`, or on `/settings`.

## Joining a host to a swarm (`swarm-join.sh`)

Separate script, not part of the TypeScript installer above: joins this host to
an existing Homerun swarm as a worker, on the **system (rootful)** Docker
daemon, then installs the Homerun Agent by downloading the installer binary and
running it with `--mode=agent`. The manager is on the system daemon too (the
`--mode=full` default): rootless Docker can't create the overlay networks swarm
services join.

Get the join token and manager address from the swarm manager itself first:

```bash
docker swarm join-token worker
```

Then, on the node you want to add:

```bash
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/swarm-join.sh \
  | sudo bash -s -- --token=<SWMTKN-...> --manager=<manager-ip>:2377
```

Same "only while the repo is public" caveat as `bootstrap.sh` above applies :
otherwise download `packages/installer/swarm-join.sh` directly and run it with
`sudo bash`. Optional flags: `--advertise-addr=<ip>` (needed when the node has
several network interfaces), `--user=` (the agent's rootless account, default
`homerun`) and `--version=` (the release the agent comes from, default
`latest`). A `--manager=` without a port gets `:2377`. Re-running it on a node
that's already in a swarm skips the join. Nodes must reach each other on
2377/tcp, 7946/tcp+udp and 4789/udp.

**Verified** against two real disposable Multipass Ubuntu 24.04 VMs: a
`--mode=full --docker=rootful` manager switched to Swarm from Settings, a second
VM running the command above, the worker listed `Ready` in `docker node ls`, a
3-replica `traefik/whoami` service deployed from the dashboard's API with two
tasks on the worker, Traefik on the manager answering from all three replicas
over the overlay network, stop/start through the API, and the agent's health
endpoint reachable on the worker. That run found and fixed:

1. The script hand-copied the TS installer's rootless steps and had drifted: it
   lacked the AppArmor user-namespace profile, so the rootless install died with
   `rootlesskit: fork/exec /proc/self/exe: permission denied` on Ubuntu 24.04.
   The script now runs the installer binary for the agent instead of copying its
   steps.
2. It joined the swarm on the rootless daemon, which can't work: no overlay
   networks. It now joins on the system daemon.
3. Re-running the installer on a host with rootless Docker failed
   (`get.docker.com/rootless` refuses to reinstall) and couldn't replace a
   running agent binary (curl exit 23, "Text file busy"). The rootless install
   is now skipped when present, the binary is downloaded next to its target and
   renamed over it, and the agent unit is restarted rather than only started.

`bun run e2e:multipass --swarm` replays this scenario (default manager install,
swarm switch, `swarm-join.sh` on a second VM, replicated deploy, Traefik check).
It runs the local script and installer, but the agent on the worker comes from
the latest published release.

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
`compose.yaml` content), and that both the source
(`bun run packages/installer/index.ts`) and the compiled binary
(`bun run scripts/build-packages.ts` → `./dist/homerun-installer-<arch>`)
produce identical dry-run output.

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
  round-tripped stop/start through the agent successfully. That run predates
  remote hosts becoming build-only: today an agent host builds images and never
  runs services, see
  [`docs/remote-hosts-and-agent.md`](../../docs/remote-hosts-and-agent.md).

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
7. That default was `http://localhost:3000`, which turned out to be worse than
   wrong links: reported live on a real install reached at
   `http://<public ip>:3000`, where the first sign-up 403'd with better-auth's
   "Invalid origin ... Current list of trustedOrigins: <http://localhost:3000>",
   making a fresh instance impossible to sign up to from anywhere but the box
   itself. Fixed by asking for (or detecting) the real address, see the Flags
   section above.

**Still not verified**: that `loginctl enable-linger` actually persists the
rootless daemon across a real reboot (not exercised, the VMs weren't rebooted).
`swarm-join.sh` has its own verification notes above.

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
