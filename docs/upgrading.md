# Upgrading Homerun

The sidebar shows the version you're running. Admins also see a notice there
when a newer GitHub release exists (checked at most once an hour). Clicking it
opens the update dialog:

- It refuses while a deployment is queued or running, or while any other job
  (backup, cron job, cleanup) is running. Wait, then **Check again**.
- **Update now** holds the job queue, so nothing new starts, then launches a
  short-lived `homerun-updater` container (`docker:cli`) with the Docker socket
  and your compose directory mounted. It runs `docker compose pull` then
  `docker compose up -d --no-deps` for the Homerun service only. Traefik and
  Postgres aren't touched.
- If your compose file or `.env` pins a version tag (`image: …:v1.0.20`, or
  `HOMERUN_VERSION=v1.0.20` with `compose.prod.yaml`), that tag is bumped to the
  new release first. `latest` is just pulled again.
- The dashboard is down for a few seconds and the page reloads itself once the
  new version answers. Jobs that were waiting run once it's back. If it doesn't
  come back, run `docker logs homerun-updater` on the host.

This only works when Homerun runs as a Docker Compose service, since it reads
its own container's compose labels to find the project. Anywhere else the dialog
explains that instead, and you upgrade by hand:

- **Docker Compose** (`compose.prod.yaml`, or the installer's generated file):
  `docker compose pull && docker compose up -d` from the directory holding it.
  Database migrations run automatically on boot, there's no separate migrate
  step.
- **The CLI** updates itself: `homerun update`, see
  [API & CLI](api-and-cli.md#cli).
- **The Homerun Agent** on a build server is a plain binary, replace it and
  restart its `systemd --user` unit, see
  [`packages/agent/README.md`](../packages/agent/README.md).

Take a Postgres dump before a major upgrade. Migrations are applied forward-only
and there's no downgrade path.
