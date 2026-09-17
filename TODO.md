# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Login wall auth-check URL: under `vite dev` the fallback is
      `host.docker.internal:3000`, derive it from the port the dev server
      actually listens on.
- [ ] Settings → General: when a Dashboard URL change moves the hostname, warn
      how many registered passkeys it will strand before saving.
- [ ] `/users`: let an admin change a user's email directly, so a verified
      address can change without SMTP.
- [ ] Make the number of retained images per service (hard-coded 5) a setting.
- [ ] Image scanning: an admin setting to fail a deploy when the scan can't run,
      instead of always letting it through.
- [ ] Notification channels: retry a failed delivery through the job queue with
      backoff instead of dropping it.
- [ ] Docker Cleanup: never prune a volume mounted by a Homerun service, even
      when that service's container is stopped.
- [ ] Backup restore: run it through the job queue and record it in the backup
      history.
- [ ] Required status checks: pass the checked commit SHA to Homerun Agent
      builds so they're pinned like local and Docker-connection builds.
- [ ] Git builds: accept a commit SHA as the ref, not just a branch or tag.
- [ ] Git providers: detect a connection missing webhook scope and offer
      reconnect right on the Source tab.
- [ ] Onboarding wizard: add a DNS automation step (Cloudflare, Pangolin).
- [ ] Notification channels: Telegram and Slack.
- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks.
- [ ] PR CI: run `semantic-release --dry-run` when `package.json`, `bun.lock` or
      `.releaserc.json` change, so a broken release plugin fails the Renovate PR
      instead of the release on `main`.
- [ ] Run `packages/installer/swarm-join.sh` against a real second host and fix
      what breaks.

## Medium

- [ ] Login wall: apply turning it on/off without a redeploy (always attach the
      forwardAuth middleware and let auth-check pass through when the wall is
      off).
- [ ] Login wall: revoke a user's app cookies immediately when they're deleted
      or re-grouped in Homerun, and re-check provider groups more often than the
      8h cookie lifetime.
- [ ] Custom SSL out of the box: ship the Traefik file provider flags and mount
      enabled in `compose.yaml`, `compose.prod.yaml` and the installer, set
      `TRAEFIK_DYNAMIC_CONFIG_DIR` by default.
- [ ] Swarm mode from the dashboard: `docker swarm init` and Traefik's
      `--providers.docker.swarmMode=true` done by Homerun when switching the
      orchestration mode, not by hand.
- [ ] Swarm mode: per-replica resource stats.
- [ ] Backups: optionally stop (or pause) the services using a volume while it's
      tarred, or run a pre-backup dump command for databases.
- [ ] Backup restore: optionally wipe the volume first, and stop/start the
      services using it automatically.
- [ ] Rollback: optionally restore the revision's env vars, resources and
      networking along with its image.
- [ ] Deploy on push without a publicly reachable dashboard: poll the branch
      head as a fallback when the webhook can't be delivered.
- [ ] Build servers without a cache registry: stream the built image back to
      this host (`docker save`/`load`).
- [ ] Services: `command`, `entrypoint`, `env_file`, labels, `cap_add`, devices
      and `privileged`, then map them in compose import and Migrate instead of
      warning.
- [ ] Migrate: carry over private registry credentials, custom start commands,
      Dokploy file mounts, and Coolify persistent storage.
- [ ] Host command cron jobs: run on the actual host (nsenter helper container),
      not inside the app container.
- [ ] Image scanning on rootless Docker: make the mirror pullable instead of
      falling back to a host pull.
- [ ] Permissions: a read-only role, scoped API keys.

## Large

- [ ] Shared resources: every account sees and manages every resource, not only
      the ones it created. Drop the `userId` filter from the finders in
      `service`, `stack`, `storage-volume`, `backup-run`, `s3-destination`,
      `build-cache-registry`, `remote-host`, `cron-job`, `cron-job-run`,
      `status-page` (including its "every service" scope), `uptime-check`,
      `deployment.listRecentForUser`, `job.listActive`/`listRecent` and
      `template` (`usable`/`owned`/`mine` become built-in vs. custom) DTOs, and
      from `search.remote.ts` and `api/v1/jobs/[jobId]`; `userId` stays as
      "created by". Personal stays personal: sessions, API keys, preferences,
      git connections, terminal sessions, the bell feed and notification
      channels. Fan events out to every account: `NotificationDTO.notify` and
      `notifyServiceError` write one row per user,
      `NotificationChannelService.dispatch` sends to every account's subscribed
      channels instead of the service creator's. Deleting a user
      (`UserService.cleanupUserResources`, called from `auth.ts`'s delete hook
      and `/users`) must reassign their rows to the acting admin (or another
      admin on self-delete) instead of removing containers and rows, every FK is
      `onDelete: cascade`; a transferred git service's builds lose the deleted
      user's git connection. Then update the unit/integration tests, UI copy
      ("mine", "you own") and `docs/` (`users-and-access.md` roles,
      `faq-and-limitations.md`).

- [ ] Health-gated rollout: keep the old container routed until the new one
      passes its health check, blue-green style.
- [ ] Builds without a Dockerfile: support Nixpacks, Railpack and Cloud Native
      Buildpacks (Heroku, Paketo) as build methods on the Source tab next to
      Dockerfile, on this host and on build servers, then carry those apps over
      in Migrate instead of blocking them.
- [ ] Pull request preview deployments for git-based services.
