# Getting started

Homerun needs three things at runtime: a Docker socket to manage containers, a
Postgres database, and Traefik for routing/TLS. Pick whichever install path
fits.

Both options below run entirely from prebuilt release binaries and Docker
images, neither needs Bun, `git`, or a source checkout on the target host. Want
to run this from source instead (to develop on it)? See
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Option A, the one-liner (fresh Linux server)

```sh
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/bootstrap.sh \
  | sudo bash -s -- --mode=full
```

This downloads the prebuilt `homerun-installer-<arch>` release binary for your
host's architecture and runs it, which:

1. Installs Docker Engine plus the host prerequisites for **rootless** Docker.
2. Creates a dedicated system user (`homerun` by default) and installs rootless
   Docker under that account, nothing this app deploys runs as root.
3. Creates the `homerun` Docker network.
4. Writes a standalone compose file and runs `docker compose up -d` against it
   under that rootless daemon: Traefik, Postgres, and the app itself, all pulled
   from published images.

Run `--mode=agent` instead of `--mode=full` if you only want this box to run the
[Homerun Agent](remote-hosts-and-agent.md#homerun-agent) as a remote
build/deploy target for a different Homerun instance, not the full app. Add
`--dry-run` to print every command without running anything, `--version=vX.Y.Z`
to pin a release instead of the latest one, and see
[`packages/installer/README.md`](../packages/installer/README.md) for the rest
of the flags (`--user=`, `--port=`).

> The installer's mutating steps (package install, rootless Docker setup,
> systemd units) are verified live for both `--mode=agent` and `--mode=full`
> against real disposable VMs, see
> [`packages/installer/README.md`](../packages/installer/README.md) for what was
> checked (and the real bugs that run found and fixed). `--dry-run` first is
> still a good habit on a box that matters, and
> `packages/installer/swarm-join.sh` specifically hasn't had the same
> real-hardware pass yet.

## Option B, Docker Compose

Already have Docker set up the way you want it (rootful is fine here) and just
want the stack? [`compose.prod.yaml`](../compose.prod.yaml) runs Traefik +
Postgres + the app itself, all pulled from published images, no installer, no
rootless setup, no source checkout:

```sh
curl -fsSLO https://raw.githubusercontent.com/orochibraru/homerun/main/compose.prod.yaml
curl -fsSLO https://raw.githubusercontent.com/orochibraru/homerun/main/.env.example
mv .env.example .env && $EDITOR .env   # set AUTH_SECRET at minimum, see configuration.md
docker network create homerun
docker compose -f compose.prod.yaml up -d
```

See the comments at the top of that file, and
[`compose.yaml`](../compose.yaml)'s (the dev-only variant, no `app` service) for
the no-compose fallback if you'd rather run each container by hand.

## First boot

Visit the app (`http://localhost:5173` in dev, `http://localhost:3000` for a
built/production run). The first account you create becomes **admin**
automatically, every account after that is created by an admin from `/users`
(direct-create or email invite), there's no public sign-up.

Signing in for the first time on a fresh instance drops you into a 5-step
onboarding wizard (Core / Docker / Traefik / Email / Review) that sets the
instance-wide config a first deploy needs: base domain, Docker socket/network,
Traefik entrypoint/cert resolver, and (optionally) SMTP for invite emails.
Everything it sets is also editable later from `/settings`, see
[Configuration](configuration.md).

## Health check

`GET /api/health` returns a plain `200 OK`, useful for a container healthcheck
or an uptime monitor, and unauthenticated by design (matches
`/api/v1/openapi.json`'s "spec/health describe shape, not data" carve-out, see
[API & CLI](api-and-cli.md)).

## Next steps

- [Configuration](configuration.md), the full environment variable reference.
- [Services](services.md), deploy your first service.
