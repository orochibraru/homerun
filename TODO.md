# TODO

The backlog, and the only one. `Small`/`Medium`/`Large` are rough size, not
priority : there is no priority ordering, pick whatever. Tick an item off and
move it under `## Done` in the same change that finishes it.

## UI

- [ ] Rename "Deployment history" with "Revisions" and put it in a separate tab.
- [ ] Merge "logs" and "errors" in one tab called "Observability"
- [ ] Adding a volume on an instance is one of the worst UX experiences of my
      life, let's change it to make it simple to link a volume to a container.
      Also pull in existing volumes on the machine.

## Small

- [ ] [App] **Convert the last five list pages to `EntityList`.** Services,
      templates, projects and storage pass their rows through it; remote hosts,
      S3 destinations, cron jobs, build cache and git providers still hand-roll
      their row internals, now inside the same panel/divider shell so they look
      identical. Their rows carry per-page extras (an agent's reachability line,
      a provider's kind badge) that want `badge`/`meta` snippets.
- [ ] [Docker] **Make the Pangolin target host configurable.** `ip` is hardcoded
      to `localhost`, which is only right when the newt tunnel runs on this host
      with host networking. Everything else needs the LAN address.

## Medium

- [ ] [App] Add a "Migrate from Dokploy" button which will ask for Dokploy
      server info (url, api token), will list all services and dry run a
      migration that the user can approve or not. The migration will only pull
      services from Dokploy, not act on anything on there.
- [ ] [App] **Restore an S3 backup.** Upload only today; getting a tarball back
      into a volume is a manual operation.
- [ ] [App] **Handle `build:` in compose import.** It's ignored, so those
      services land needing their Source tab pointed at a git repo by hand.
- [ ] [App] **Run cron jobs on remote daemons, and stream their output.**
      `runOneOff` takes a remote connection but nothing passes one, and output
      only appears once the run has finished.
- [ ] [Docker] **Reclaim project networks whose project row is gone.**
      Twenty-one leaked from test runs on the dev box and exhausted Docker's
      default address pools outright, which fails _every_ new network with "all
      predefined address pools have been fully subnetted" : compose import, new
      projects and three integration tests all broke at once, with the real
      cause nowhere in the error. Docker Cleanup's network prune only sees
      unattached networks.
- [ ] [Arch] **Check the swarm prerequisites during onboarding.**
      `docker swarm init` and Traefik's `--providers.docker.swarmMode=true` are
      both manual today. `packages/installer/swarm-join.sh` is also still
      unverified against a real host.
- [ ] [Schema] **Extract the five auth-policy columns off `service`.** It has 46
      columns. This is the obvious split, but it touches the `policyVersion`
      HMAC, `gated-service-cache.ts`, `labels.ts` and needs a migration for no
      behaviour change. Ride along with the next change in that area, or close
      this.
- [ ] [SDKs] **GitHub Actions and GitLab CI presets**, with a setting for
      tracking latest vs. tagged.
- [ ] [Tests] **Cover `deploy.service.ts` and `app-access.service.ts`.** Neither
      has tests, and they are the deploy pipeline and the login wall's access
      decision.

## Large

- [ ] [App] **Self-update from the sidebar.** Print the version in the sidebar
      from `package.json` (computed in CI by semantic-release before the build),
      compare it to the latest GitHub release on page load, and surface a notice
      when a newer one exists. Clicking it opens a modal that checks no
      deployments are queued, then starts the update sequence: hold the worker
      for all deployments and actions, then start an update worker that stops
      the main app, pulls its latest image and brings it back up.
- [ ] [Auth] **Passkey and 2FA on the auth pages**, plus instance-level policies
      to require them. The plugin and client are already wired
      (`@better-auth/passkey`), nothing in `src/routes` uses them.
- [ ] [Refactor] **Make the legal deploy combinations a union.**
      `deploy.service.ts` is ~600 lines over `buildSource` x `buildTarget.kind`
      x `orchestrationMode`. Most combinations are illegal and only rejected by
      a `throw` at the end of the pipeline, which is how the autoscale/swarm bug
      happened.
- [ ] [Tooling] **Homerun SDK**, a shared library with the CLI.
- [ ] [SDKs] **Terraform and Pulumi providers.**
- [ ] [Docker] **Image security scanning.**

## Done

- [x] [App] **Allow changing the account email.** `/profile`'s email field is
      editable now, wired to better-auth's `changeEmail` : an unverified address
      changes on save, a verified one only after confirming from the link sent
      to the current address, and the field is locked with an explanation when
      that's impossible because SMTP isn't configured.
- [x] [App] **Add a "send test email" button to the email settings tab.** Sends
      to the signed-in admin's own address using the saved settings, and reports
      the SMTP server's own error when it fails.
- [x] [App] **Drop the `homerun.yaml` bind-mount from `compose.prod.yaml`.** The
      compose path needs nothing but `.env` now ; `docs/configuration.md` shows
      the mount to add for anyone who does want the file.
- [x] [App] **Reconcile a swarm service's status on its own pages.** The service
      layout and `GET /api/v1/services/:id` both sync when either `containerId`
      or `swarmServiceId` is set ; `syncServiceStatus` already knew how to
      inspect a swarm service, nothing reached it.
- [x] [Docker] **Ensure the project network exists in
      `connectToProjectNetwork`.** Calls `ensureProjectNetwork` first, same
      re-assert-every-deploy shape as `ensureSharedNetwork`.
- [x] [Schema] **Delete a user's `project` rows on account deletion.** Already
      done : `UserService.cleanupUserResources` deletes them (after removing
      each project's Docker network), and `project.userId` is
      `onDelete: "cascade"` on top of that.
- [x] [API] **Remove a swarm service on `DELETE /api/v1/services/:id`.** Same
      `swarmServiceId` branch the dashboard's own delete action already had.
- [x] [App] **Make the UI less blah.** The gridded, blurred, low-contrast look
      is gone: no ambient backdrop and no `body::after` grid, `glass` is now an
      opaque `panel`, text tokens are pushed to real contrast, the radius scale
      is tighter, and primary buttons are ink-on-white / white-on-ink instead of
      a tinted fill. The signed-out pages are one centred column now, not a
      two-pane product pitch. See `.agents/notes/ui.md` for the token map and
      for how to screenshot a visual change before calling it done.

- [x] [App] **Delete-all notifications button.** "Clear all" next to "Mark all
      read" in the bell, `NotificationDTO.deleteAll` behind a
      `deleteAllNotifications` command.
- [x] [App] **Domain routing through Pangolin 404s.** The Target was created as
      `http` against port 80, and every router Homerun writes lives on the
      `websecure` entrypoint : Pangolin reached an entrypoint with no matching
      router, and Traefik answered 404. Targets are `https` against 443 now, and
      the default `pangolinTargetPort` moved to 443.
- [x] [App] **Terminate TLS on both ends.** Same change as above, from the other
      direction: Pangolin still terminates the public connection, and the hop
      from its tunnel to this host is TLS too rather than plaintext to :80.
- [x] [App] **A Let's Encrypt email set in the UI does nothing.** Traefik reads
      the ACME account from static config at startup, so saving it only ever
      wrote a database row. `DockerService.applyAcmeEmail` rewrites
      `--certificatesresolvers.<resolver>.acme.email` on the running container
      and recreates it, and does nothing when the value is unchanged.
- [x] [App] **Switching to swarm mode did nothing.** It now runs
      `docker swarm init` when the daemon isn't a manager, creates the
      attachable overlay (`<network>-swarm`, since a live bridge network can't
      be converted), attaches Traefik to it and turns on Traefik's swarm
      provider. Switching back turns the provider off and leaves the swarm
      alone.
- [x] [UI] **Redesign, following Penombre.** Aurora background, film grain,
      frosted translucent panels, violet brand, a floating rounded content pane
      on a transparent sidebar rail, soft corners. The accent picker now drives
      buttons too (it only moved `--color-accent`, never the fill buttons paint
      with), and monospace is back to code, logs and terminals only.
- [x] [UI] **One reusable list/grid.** `entity-list.svelte` takes
      title/subtitle/description/href plus `media`/`badge`/`meta`/`actions`
      snippets and renders both the list and the card view, which is what fixed
      the double borders and the inconsistent spacing between pages.
- [x] [UI] **A fuller dashboard.** A recorded `stat_sample` history (per-minute
      sampler, host and per-container), a range-switching chart
      (live/1h/24h/7d/30d/1y/all × CPU/memory/traffic) and a per-service usage
      table sortable by CPU, memory or traffic.
- [x] [UI] **Stats first on a service's overview**, scoped to that service, plus
      a Connections diagram showing what it needs and what needs it, derived
      from env vars pointing at another service's slug.
