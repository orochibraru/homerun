# Getting started

Homerun needs three things at runtime: a Docker socket to manage containers, a Postgres database, and Traefik for routing/TLS. Pick whichever install path fits.

## Option A, the one-liner (fresh Linux server)

```sh
curl -fsSL https://git.ombrage.space/orochibraru/homerun/raw/branch/main/installer/bootstrap.sh \
  | sudo bash -s -- --repo=https://git.ombrage.space/orochibraru/homerun.git --mode=full
```

This bootstraps Bun (if missing), clones the repo, and runs the real installer (`installer/src/index.ts`), which:

1. Installs Docker Engine plus the host prerequisites for **rootless** Docker.
2. Creates a dedicated system user (`homerun` by default) and installs rootless Docker under that account, nothing this app deploys runs as root.
3. Creates the `homerun-network` Docker network.
4. Runs `docker compose up -d` against this repo's own [`compose.yaml`](../compose.yaml) under that rootless daemon, Traefik, Postgres, and the app itself.

Run `--mode=agent` instead of `--mode=full` if you only want this box to run the [Homerun Agent](remote-hosts-and-agent.md#homerun-agent) as a remote build/deploy target for a different Homerun instance, not the full app. Add `--dry-run` to print every command without running anything, and see [`installer/README.md`](../installer/README.md) for the rest of the flags (`--ref=`, `--user=`, `--port=`).

> The installer's mutating steps (package install, rootless Docker setup, systemd units) are new, verify the result on your own box before relying on it for anything that matters. `--dry-run` first is a good habit.

## Option B, Docker Compose, from source

For local development, or if you'd rather run the app directly on the host instead of the installer's rootless setup:

```sh
git clone https://git.ombrage.space/orochibraru/homerun.git && cd homerun
bun install
docker network create homerun-network
docker compose up -d          # Traefik + Postgres
cp .env.example .env          # see configuration.md, or just edit env vars below directly
bun run db:generate
bun run dev                   # or: bun run build && bun run start
```

`compose.yaml` only runs Traefik and Postgres, the app itself runs directly on the host (`bun run dev`/`bun run start`), not in a container, so it can reach `/var/run/docker.sock` without extra socket-forwarding. See the comments at the top of [`compose.yaml`](../compose.yaml) for the no-compose fallback (standalone `docker network create` + `docker run`).

A prebuilt image of the app itself is also published on every push to `main` (`git.ombrage.space/orochibraru/homerun:latest`, see the [`Dockerfile`](../Dockerfile)) if you'd rather run the app in a container too, you'll need to give that container access to the host's Docker socket (`-v /var/run/docker.sock:/var/run/docker.sock`) and put it on `homerun-network` yourself, since `compose.yaml` doesn't wire this up for you yet.

## First boot

Visit the app (`http://localhost:5173` in dev, `http://localhost:3000` for a built/production run). The first account you create becomes **admin** automatically, every account after that is created by an admin from `/users` (direct-create or email invite), there's no public sign-up.

Signing in for the first time on a fresh instance drops you into a 5-step onboarding wizard (Core / Docker / Traefik / Email / Review) that sets the instance-wide config a first deploy needs: base domain, Docker socket/network, Traefik entrypoint/cert resolver, and (optionally) SMTP for invite emails. Everything it sets is also editable later from `/settings`, see [Configuration](configuration.md).

## Health check

`GET /api/health` returns a plain `200 OK`, useful for a container healthcheck or an uptime monitor, and unauthenticated by design (matches `/api/v1/openapi.json`'s "spec/health describe shape, not data" carve-out, see [API & CLI](api-and-cli.md)).

## Next steps

- [Configuration](configuration.md), the full environment variable reference.
- [Services](services.md), deploy your first service.
