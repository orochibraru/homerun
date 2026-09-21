# Upgrading Homerun

The sidebar shows the version you're running. Admins also see a notice there
when a newer GitHub release exists (checked every ten minutes). Clicking it
opens the update dialog:

- It refuses while a deployment is queued or running, or while any other job
  (backup, cron job, cleanup) is running. Wait, then **Check again**.
- **Update now** holds the job queue, so nothing new starts, then launches a
  short-lived `homerun-updater` container (`docker:cli`) with the Docker socket
  and your compose directory mounted. It runs `docker compose pull` then
  `docker compose up -d --no-deps` for the Homerun app and worker services only.
  Traefik, Postgres and the Newt tunnel aren't touched.
- If you installed with the installer, your `compose.yaml` is **generated** (its
  first line is `# homerun:generated`). Every update overwrites it (and
  `compose.swarm.yaml` on a swarm install) with the file shipped in the new
  release, because an old compose file can break a new version. Don't edit it:
  put your settings in `.env` next to it (`HOMERUN_HOST`, `ORIGIN`,
  `DASHBOARD_DOMAIN`, `ACME_EMAIL`, `POSTGRES_*`, …) or in `homerun.yaml`. The
  update writes the target version to `HOMERUN_VERSION` in `.env`.
- A compose file you wrote yourself is never replaced. If it or `.env` pins a
  version tag (`image: …:v1.0.20`, or `HOMERUN_VERSION=v1.0.20` with
  `compose.prod.yaml`), that tag is bumped to the new release first. `latest`
  and `canary` are just pulled again.
- The dashboard is down for a few seconds and the page reloads itself once the
  new version answers. Jobs that were waiting run once it's back. If it doesn't
  come back, run `docker logs homerun-updater` on the host.

## Release channels

Pick one on **Settings → General → Release channel**:

- **Stable** (the default): the update notice offers stable releases (`vX.Y.Z`,
  cut by hand from a canary that's already been running), the same ones the
  installer, `install.sh` and `homerun update` follow.
- **Canary**: the notice offers every build merged to `main`, published as the
  `:canary` image and the rolling
  [`canary` prerelease](https://github.com/orochibraru/homerun/releases/tag/canary).
  Updating moves your install to the `canary` tag (`HOMERUN_VERSION=canary`).

Switching back from canary to stable never downgrades. The notice just stays
quiet until a stable release is newer than the canary you run, and that update
moves you back to a pinned stable tag.

## Without the dashboard

If you can't reach the dashboard, the same update runs from the
[CLI](api-and-cli.md#cli), logged in as an admin:

```bash
homerun instance status             # running version, channel, latest version, and whether it can update now
homerun instance channel canary     # switch the release channel (or back to stable)
homerun instance update             # start the update and follow it until the new version answers
```

It goes through the same checks and the same `homerun-updater` container as
**Update now**, and prints the reason when it refuses. Scripts can call
`GET /api/v1/instance/update`, `POST /api/v1/instance/update` and
`GET /api/v1/instance/update/progress` directly.

## When it can't update itself

This only works when Homerun runs as a Docker Compose service, since it reads
its own container's compose labels to find the project. Anywhere else the dialog
explains that instead, and you upgrade by hand:

- **Docker Compose** (`compose.prod.yaml`, or the installer's generated file):
  `docker compose pull && docker compose up -d` from the directory holding it.
  Database migrations run automatically on boot, there's no separate migrate
  step.
- **The CLI** updates itself: `homerun update`, see
  [API & CLI](api-and-cli.md#cli).
- **The Homerun Agent** on a build server is a plain binary (`homerun-worker`
  running in agent mode), replace it and restart its `systemd --user` unit, see
  [`cmd/worker/README.md`](../cmd/worker/README.md).

Take a Postgres dump before a major upgrade. Migrations are applied forward-only
and there's no downgrade path.
