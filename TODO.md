# TODO

The backlog, and the only one. `Small`/`Medium`/`Large` are rough size, not
priority : there is no priority ordering, pick whatever. Tick an item off and
move it under `## Done` in the same change that finishes it.

## Small

- [ ] [API] **Remove a swarm service on `DELETE /api/v1/services/:id`.** The
      handler only removes a container, so deleting a swarm-mode service through
      the API leaves its swarm service running on the host. The dashboard's own
      delete action already handles both.

## Medium

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
