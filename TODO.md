# TODO

The backlog, and the only one. `Small`/`Medium`/`Large` are rough size, not
priority : there is no priority ordering, pick whatever. Tick an item off and
move it under `## Done` in the same change that finishes it.

## Not prioritized / No size / Too lazy to size just got an idea

## Small

- [ ] [Pangolin] **No certificate for `*.penombre.space` at the Pangolin edge**,
      so every subdomain is served its Traefik default self-signed one and
      browsers warn (the apex has a real Let's Encrypt cert, which is the tell).
      The domain is `verified: true, type: wildcard, preferWildcardCert: true`
      with no `certResolver` : issue the wildcard over DNS-01, or turn
      `preferWildcardCert` off and let it issue per subdomain. Nothing in this
      repo can fix it.

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
