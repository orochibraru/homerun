# Upgrading Homerun

The sidebar shows the version you're running. Admins can click it any time to
open an update-status dialog; a notice also appears there on its own when a
newer GitHub release already exists (checked every ten minutes). A **Check for
updates** button inside the dialog bypasses that ten-minute cache and asks
GitHub right away. Once an update is available, the dialog behaves as follows:

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
  `compose.prod.yaml`), that tag is bumped to the new release first. `latest`,
  `canary` and `nightly` are just pulled again.
- **A broken release never replaces a working one.** Before switching, the
  updater boots the new version next to the running one as a throwaway
  `homerun-update-candidate` container. The candidate isn't routed by Traefik
  and runs no jobs. The updater only switches once the candidate answers
  `/api/v1/ready`, which needs the database and the whole auth layer working. If
  it doesn't within about two minutes, the updater restores your compose files
  and `.env`, leaves the running version alone, and the dashboard says the
  update didn't go through. The candidate does apply the new version's database
  migrations, which are additive.
- After the switch the updater waits for the new app to answer the same check.
  If it doesn't, it rolls back: it restores the previous files and recreates the
  containers on the version you had.
- The dashboard is down for a few seconds during the switch itself, and the page
  reloads itself once the new version answers. Jobs that were waiting run once
  it's back. If something looks wrong, run `docker logs homerun-updater` on the
  host: every step, and any rollback, is in there.

## Release channels

Pick one on **Settings → General → Release channel**:

- **Stable** (the default): the update notice offers stable releases (`vX.Y.Z`,
  cut by hand from a canary that's already been running), the same ones the
  installer, `install.sh` and `homerun update` follow.
- **Canary**: the notice offers every build merged to `main` once it passed the
  end-to-end tests, published as the `:canary` image and a `vX.Y.Z-canary.N`
  [prerelease](https://github.com/orochibraru/homerun/releases). Updating moves
  your install to the `canary` tag (`HOMERUN_VERSION=canary`).
- **Nightly**: the same builds as canary, published as the `:nightly` image and
  a `vX.Y.Z-nightly.N` prerelease as soon as they're built, before the
  end-to-end tests run. A build that fails them still ships here, so expect
  breakage. Updating moves your install to the `nightly` tag
  (`HOMERUN_VERSION=nightly`). The update's own pre-switch check still keeps a
  build that can't boot off your instance.

Canary and nightly builds of the same merge share their number `N`, so switching
between them works both ways. Switching to a more stable channel never
downgrades: the notice stays quiet until that channel has a release newer than
the one you run, and that update moves you to its tag.

## Without the dashboard

If you can't reach the dashboard, the same update runs from the
[CLI](api-and-cli.md#cli), logged in as an admin:

```bash
homerun instance status             # running version, channel, latest version, and whether it can update now
homerun instance channel canary     # switch the release channel (stable, canary or nightly)
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
