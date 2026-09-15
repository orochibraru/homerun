# TODO

The backlog, and the only one. `Small`/`Medium`/`Large` are rough size, not
priority : there is no priority ordering, pick whatever. Tick an item off and
move it under `## Done` in the same change that finishes it.

## Not prioritized / No size / Too lazy to size just got an idea

- [ ] **[WIP]** [Docker] **Routing doesn't work on the test server.** Reproduced
      on 37.27.7.3 (pr-14, rootless docker under the `homerun` user), and the
      app's half is **fixed**: `PangolinService` never sent `sso`, Pangolin
      defaults it to true, so every resource it created was behind Pangolin's
      login (302 to `/auth/resource/…` in a browser, bare 401 otherwise). It now
      follows every create with `POST /resource/{id}` `{"sso": false}` and does
      the same on the already-exists path, so a redeploy heals the ones created
      before it, see `.agents/notes/dns.md`. Traefik itself was never wrong: on
      the box, `curl -k -H "Host: dashy.penombre.space" https://127.0.0.1`
      answers 200, and the target was already `localhost:443` with
      `method=https`. Left to do, all of it on the instance rather than in this
      repo: 1. Ship this image to the test server and redeploy each service (or
      flip the five existing resources by hand:
      `POST /resource/{317,318,333,335,336}` with `{"sso": false}`). The sandbox
      refuses to make that call from here, it reads as an auth weakening. 2.
      **No TLS certificate for `*.penombre.space` at the Pangolin edge**, so
      every subdomain gets Pangolin's Traefik default self-signed cert while the
      apex has a real Let's Encrypt one. The domain is
      `verified: true, type: wildcard, preferWildcardCert: true` with no
      `certResolver`: issue the wildcard over DNS-01, or turn
      `preferWildcardCert` off and let it issue per-subdomain. 3. **The box's
      `compose.yaml` predates the dashboard router**, so `app` carries no
      Traefik labels and nothing answers for `dash.penombre.space` (whose target
      also points at `:80`, where no router exists). Regenerate it with the
      current installer, which emits the `DASHBOARD_DOMAIN` router.
- [ ] Ability to edit a docker registry
- [ ] Add penombre template (github.com/orochibraru/penombre)
- [ ] Add tags to templates to make search more relevant.

## Small

- [ ] [Agent] **`packages/agent/docker.ts` can't clone a private repo either.**
      It shells out to `git` with the raw URL, so the same "could not read
      Username" failure applies on an agent-dispatched build. The main app now
      injects a connected provider's token (`resolveGitCredential`); the agent
      path needs the credential passed over the wire.

- [ ] [Docs] **CLAUDE.md says a `(protected)` page root is `p-6 md:p-8`; 26 of
      27 pages use `p-5 md:p-6`.** The doc is the outlier, not the code. Decide
      which is right and make them agree rather than leaving new pages to guess.

- [ ] [Agent] **`packages/agent/docker.ts` shells out to `git` and its image has
      no `git`** (`alpine:3` + `ca-certificates wget libstdc++ libgcc`), so an
      agent-dispatched git build fails with ENOENT the same way the main app's
      did. Same fix: clone in a container into a volume. Found while doing the
      main app's half.

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

- [x] [UI] **Revisions is its own tab**, split out of the Overview, and **Logs +
      Errors are one "Observability" tab**. `logs/` keeps only its SSE endpoint;
      the page is gone.
- [x] [UI] **Mounting a volume is one step.** The picker lists Homerun's own
      volumes _and_ the Docker volumes already on the machine
      (`DockerService.listHostVolumes`); choosing one of those registers it in
      Storage as part of mounting, instead of making you create it first.
- [x] [UI] **A database service prints its connection URLs**, including the JDBC
      one where the engine has a driver, with copy buttons on its Overview.
- [x] [UI] **Clicking a linked service refreshes its logs.** `LiveLogViewer`
      connected on mount only, and SvelteKit reuses the component across the
      same route, so the previous container's stream kept running under the new
      service. It reconnects on `serviceId`/`containerId` now.
- [x] [UI] **Dashboard**: every panel is rounded, recent deployments carry
      status, slug, digest and duration, and a **Recent errors** panel lists
      what the log persister caught, linking into each service's Observability.
- [x] [UI] **Git provider Connect/Disconnect are labelled buttons**, not
      icon-only ones.
- [x] [UI] **The wizard sets networking before creation**: custom domain (the
      DNS mapping), the login wall, network mode and port protocol, all
      persisted by `create`, not just by the Networking tab afterwards.
- [x] [UI] **Repos list themselves on provider select**, in a filtering combobox
      (shadcn `command` + `popover`) instead of a "List repos" button and a
      plain `<select>`.
- [x] [UI] **"Building image"** replaces "Fetching image" on a git-sourced
      deploy's progress, and the progress log **follows the tail** as it
      streams.

- [x] [UI] **Project pages are summaries.** Stats, recent deployments, a
      project-scoped resource table and a searchable service list with grid/list
      modes. Rename and the danger zone moved to `/projects/<id>/settings`
      behind a Settings button.
- [x] [UI] **Revisions carry what actually ran**: the `image:tag` of that
      deploy, its digest, its duration, and for a git build the commit it built,
      linked to the provider. (`deployment` gained `image_ref`, `git_commit`,
      `git_ref`.)
- [x] [UI] **The avatar button matches the bell** : same size, radius and hover.
- [x] [UI] **Recent errors name their service**, and link into that service's
      Observability rather than always to System Logs.
- [x] [UI] **System Logs lists this instance's own stack** (anything with a
      compose project label that Homerun didn't create : the app, Postgres,
      Traefik, Newt) and streams any of their logs inline.
- [x] [App] **Newt detection + template.** Settings → Networking says whether a
      Pangolin tunnel client is running on this host, and
      `Newt (Pangolin     tunnel)` is a built-in template.
- [x] [App] **Datastores aren't DNS-resolvable by default**, in the wizard and
      for templates : `isDatabaseImage` off the link-engine detection.
- [x] [UI] **Right-click context menu on services**: start/stop/restart,
      settings, delete, plus Link to…, group into a project and ungroup, with
      `EntityList` gaining a `wrapper` snippet so rows can be wrapped without
      every page rebuilding its own row markup.
- [x] [App] **Uptime monitoring.** Two probes a minute per service : internal
      (the container's own port on the Docker network) and external (the
      hostname Traefik publishes), stored one row per service+kind. The service
      Observability tab shows both with per-probe troubleshooting steps when one
      fails, and the dashboard shows a banner of everything currently failing.
      On by default, `service.uptimeEnabled` turns it off.
- [x] [UI] **Link two services from the context menu.** The dialog injects the
      connection variables (URL / JDBC / separate vars, prefilled from the
      target's own image and env) and optionally puts both on one project
      network : whichever project either is already in, or a new one named after
      the source.
- [x] [App] **The internal uptime probe could never succeed for a database.**
      `Bun.connect({ socket: {} })` throws
      `Expected at least "data" or "drain"     callback` before it opens
      anything, so every TCP probe failed and stored that string as the reason —
      the exact rows the Postgres container had. `tcpConnect` now passes real
      handlers and resolves on `open`, covered against a live `Bun.listen`
      socket in `tests/unit/app/uptime-probe.test.ts` (the tests fail against
      the old implementation).
- [x] [App] **Status pages.** `status_page` + `status_page_service` +
      `notification_channel`, a "Status Page" entry in the Workspace sidebar
      group, a per-page editor (global / one project / hand-picked services),
      and a public `/status/<slug>` route outside `(protected)` that renders
      names, up/down and uptime percentages only — never images, ports,
      hostnames or probe errors. Webhook and email channels fire on an actual
      up→down / down→up transition (`detectTransitions`, compared against the
      previous beat so a first reading never alerts), scoped per page or
      account-wide, with a "Send test" button.
- [x] [Docker] **Git builds clone in a container into a volume**, not on the
      host. This was a production bug, not a refactor: the runtime image has no
      `git`, so `execFile("git", …)` failed with ENOENT and git builds only
      worked in dev. The build context is streamed to the _same_ daemon, so no
      cache registry is needed the way a real DinD sidecar would have required.
      Fixed a commit-SHA corruption on the way (`Building commit )68c1b9` — the
      log frame header's length byte).
- [x] [UI] **`CopyBox`**, used for the confirmation modal's phrase (so it can be
      copied rather than retyped), the connection strings panel and the API-key
      reveal, replacing three hand-rolled copy affordances.
- [x] [App] **Pull policy per service** (`always` by default, plus `missing` and
      `never`), on the Settings tab and the REST API. `shouldSkipPull` is pure
      and unit-tested; `never` with no local image fails the deploy with a real
      message instead of silently running something stale.
- [x] [App] **Clear heartbeats / clear errors**, both on the Observability tab,
      and errors are linked to revisions: a deploy that reaches "running" sets
      `errorsDismissedAt`/`errorsDismissedByDeploymentId`, so the errors it
      superseded are hidden behind a "N earlier errors hidden — cleared by
      revision X" banner with a Show them toggle. Nothing is deleted except
      heartbeats.
- [x] [Docker] **A private git repo can be cloned.** The clone container has no
      credential helper and no tty, so git asked for a username and died with
      "No such device or address". `resolveGitCredential` injects a connected
      provider's OAuth token into the clone URL (matched by host),
      `GIT_TERMINAL_PROMPT=0` makes the failure immediate, the URL is redacted
      in every log line, and an auth failure now says which host and what to do.
- [x] [UI] **A failed deploy takes you to the failed revision** instead of
      silently refreshing: the SSE `done` handler checks the final status and
      navigates to `revisions?deployment=<id>`, which auto-expands that
      revision's log.
- [x] [UI/Perf] **Navigation no longer waits on the Docker daemon.** Every
      daemon round-trip that sat in a `load` moved to a remote query the page
      fills in behind itself: the services list's and every service tab's status
      reconciliation (`syncServiceStatuses`), the dashboard's and `/settings`'
      setup diagnostics and Newt lookup (`getSetupStatus`/`getNewtContainer`),
      Docker Cleanup's `system df` preview, System Logs' Traefik + stack lookup,
      and the volumes tab's host-volume picker. Three new shared components came
      with it — `alert.svelte` (which also replaced eight hand-rolled copies of
      the same red banner), `async-block.svelte` (pending/ready/failed over one
      query, with a Retry) and `error-boundary.svelte` (wrapped around the
      dashboard's content, so a render error is a banner rather than a blank
      page). The e2e suite went from 1.4m to 49s on the same machine.
- [x] [UI] **The accent picker reaches portaled content.** It was a `style=""`
      on the `(protected)` wrapper, so every dialog, popover and dropdown
      bits-ui portals to `document.body` kept the stock violet — `link`-variant
      buttons in the notification bell most visibly. It's a `:root:root` rule in
      `<svelte:head>` now (doubled selector because SvelteKit emits component
      head content before its own stylesheets), covered by
      `tests/e2e/ui-appearance.spec.ts`.
- [x] [Tests] **The wizard's validation-failure e2e test stopped deadlocking.**
      The toaster and the wizard's step nav are both bottom-right, so the
      failure toast covered "Next"; hovering it to reach the button paused
      sonner's dismiss timer and the click never landed. The test dismisses the
      toast instead. This was CI's real E2E failure, on every attempt, not
      flake.
- [x] [App] **A probe per service type**, so a healthy database stops reading as
      down with a raw Bun fetch diagnostic. `internalProbeMethod` prefers the
      image's own `HEALTHCHECK` (`State.Health` via
      `DockerService.containerHealth`), falls back to a plain TCP connect for
      datastores, and only then speaks HTTP. `probeErrorMessage` strips Bun's
      "pass `verbose: true`" tail and names the real failure.
- [x] [CI] **Dropped the `nick-fields/retry` wrapper** from Tests (Unit), Tests
      (Integration), Tests (E2E) and screenshot Capture : three attempts buried
      the first failure's output, which is the one worth reading. Plain `run:`
      with a step-level `timeout-minutes`.
- [x] [UI] **Revision, deploy and cron-run logs render in JetBrains Mono**, like
      the live log viewer, system logs and the terminal already did.
- [x] [App] **Uptime heartbeats**, and no external probe on a loopback host.
      `uptime_check` is append-only now, the panel draws the last 40 beats as a
      strip with the uptime percentage over that window, and
      `externalProbeSkipReason` skips `localhost`/`127.0.0.1`/`*.localhost`
      instead of reporting a meaningless outage.
