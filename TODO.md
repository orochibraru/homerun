# TODO

## Architecture

- [ ] Add native Newt tunnel integration for Pangolion support and domain
      mapping
- [ ] Add Cloudflare integration for domain mapping

## Orchestration

- [ ] Convert to using docker swarm with docker stack deploy, easier to scale,
      easier to manage.

## Git providers & builds

- [ ] Let users pick a repo instead of pasting a URL: list repositories from a
      configured git provider, with "paste a URL" as a fallback for when no
      provider is configured.
- [ ] Support remote hosts as dedicated build servers, so builds don't load the
      main server.
- [ ] Add build-cache support via a Docker registry : new sidebar page to
      configure registries used for caching.

## UI / UX

- [ ] Add color coding throughout the UI so things are easier to visually
      locate.
- [ ] Build reusable components for listing entities two ways: card view and
      list view.
- [ ] Add submenus / proper categorization to the sidebar nav : needed once the
      page count below grows.

## SSL / Certificates

- [ ] Add an instance setting for the ACME account email (needed for cert
      generation), alongside the existing custom-cert support.

## Notifications

- [ ] Add a notification system: a bell icon in the header with a feed of events
      : new deployment, auto-update, start, stop, new service, deploy failures,
      app runtime failures.

## Storage & backups

- [ ] Add a page to configure S3 destinations for storage (mainly for backups).
- [ ] Add a dedicated backups page: configure per-volume backups and view a run
      log (when they ran, success/failure). Scheduled backups should also
      surface on the cron page below.

## Scheduling

- [ ] Add a cron scheduler page (surfacing cron-redeploy, backup, and autoscale
      scheduler activity in one place).

## Environment variables

- [ ] Support pasting a `.env` file into the Environment field, auto-populating
      one env var row per line.

## Chore

- [ ] I don't see the point of having a separate package.json file in installer
      and agent since they're ultimately compiled as binaries. Clean this up.
