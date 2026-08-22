# TODO

## Architecture

- [ ] Add native Newt tunnel integration for Pangolion support and domain
      mapping
- [ ] Add Cloudflare integration for domain mapping
- [x] Add tabs to the user's profile page so they can view: "Personal
      Information", "Security (password)", "Sessions", "Authorized Clients"

## Orchestration

- [ ] Convert to using docker swarm with docker stack deploy, easier to scale,
      easier to manage.

## Git providers & builds

- [x] Let users pick a repo instead of pasting a URL: list repositories from a
      configured git provider, with "paste a URL" as a fallback for when no
      provider is configured.
- [ ] Support remote hosts as dedicated build servers, so builds don't load the
      main server.
- [x] Add build-cache support via a Docker registry : new sidebar page to
      configure registries used for caching.

## UI / UX

- [ ] Add color coding throughout the UI so things are easier to visually
      locate.
- [ ] Build reusable components for listing entities two ways: card view and
      list view.
- [x] Add submenus / proper categorization to the sidebar nav.

## SSL / Certificates

- [x] Add an instance setting for the ACME account email (needed for cert
      generation), alongside the existing custom-cert support.

## Notifications

- [x] Add a notification system: a bell icon in the header with a feed of events
      : new deployment, auto-update, start, stop, new service, deploy failures,
      app runtime failures.

## Storage & backups

- [x] Add a page to configure S3 destinations for storage (mainly for backups).
- [x] Add a dedicated backups page: configure per-volume backups and view a run
      log (when they ran, success/failure). Scheduled backups should also
      surface on the cron page below.

## Scheduling

- [x] Add a cron scheduler page (surfacing cron-redeploy, backup, and autoscale
      scheduler activity in one place).

## Environment variables

- [x] Support pasting a `.env` file into the Environment field, auto-populating
      one env var row per line.

## Chore

- [x] Publish a Docker image for the Homerun Agent (own `Dockerfile` +
      `.github/workflows` job, same shape as the main app's `docker.yaml`), so
      `agent/README.md`'s "already running Docker your own way" install path
      doesn't dead-end at "prebuilt binary or build from source" for someone
      who'd rather run it as a container. Use the docker bake conf to build.
