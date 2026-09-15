# TODO

No priority, pick whatever.

- [ ] [Tooling] Homerun SDK (shared lib with CLI)
- [ ] [App] Allow email change
- [ ] [App] Add email config test button in UI
- [ ] [App] `compose.prod.yaml` bind-mounts `./homerun.yaml`, so Option B still
      makes an operator `touch homerun.yaml` before the stack starts even though
      the file is entirely optional and everything in it is a `/settings` field.
      Drop the mount (or make it a named volume / optional mount) so the
      documented compose path needs no file at all beyond `.env`.
- [ ] [App] No restore flow for S3 backups. Upload only; getting a tarball back
      into a volume is manual.
- [ ] [App] Compose import ignores `build:`, so those services land needing
      their Source tab pointed at a git repo by hand.
- [ ] [App] Cron jobs only run on the local daemon (`runOneOff` takes a remote
      connection, nothing passes one) and output only shows up after the run
      finishes.
- [ ] [App] A swarm-mode service's status is never reconciled on its own pages:
      `services/[serviceId]/+layout.server.ts` only calls `syncServiceStatus`
      when `containerId` is set, which is null for a swarm service, so the
      status pill is whatever the last deploy wrote.
- [ ] [Docker] `connectToProjectNetwork` assumes the project's network exists
      rather than ensuring it, unlike `ensureSharedNetwork` on the same path, so
      a project whose network was removed out from under it (a prune, a Docker
      Cleanup run) fails at deploy with a raw dockerode 404 forever. Call
      `ensureProjectNetwork` first.
- [ ] [Docker] Nothing reclaims a project network whose project row is gone.
      Twenty-one leaked from test runs on the dev box and exhausted Docker's
      default address pools outright, which fails _every_ new network with "all
      predefined address pools have been fully subnetted" : compose import, new
      projects and three integration tests all broke at once, with the real
      cause nowhere in the error. Docker Cleanup's network prune only sees
      unattached ones.
- [ ] [Auth] Passkey + 2FA on the auth pages, and instance-level policies to
      require them. The plugin and client are already wired
      (`@better-auth/passkey`), nothing in `src/routes` uses them.
- [ ] [Tests] `deploy.service.ts` and `app-access.service.ts` have no tests.
      They are the deploy pipeline and the login wall's access decision.

- [ ] [Docker] Security scanning.
- [ ] [SDKs] Terraform/Pulumi providers.
- [ ] [SDKs] GitHub Actions + GitLab CI presets, with a setting for tracking
      latest vs. tagged.
- [ ] [Arch] Swarm prerequisites are manual: `docker swarm init` and Traefik's
      `--providers.docker.swarmMode=true`. Onboarding should check for both.
      `packages/installer/swarm-join.sh` is still unverified against a real
      host.
- [ ] [Refactor] `deploy.service.ts` is ~600 lines over `buildSource` x
      `buildTarget.kind` x `orchestrationMode`. Most combinations are illegal
      and only rejected by a `throw` at the end of the pipeline, which is how
      the autoscale/swarm bug happened. Make the legal set a union instead.
- [ ] [Schema] `service` has 46 columns. The five auth-policy ones are the
      obvious extraction, but it touches the `policyVersion` HMAC,
      `gated-service-cache.ts`, `labels.ts` and a migration for no behaviour
      change. Ride along with the next change in that area, or close this.

## Done

- [x] [UI] Auth and onboarding looked like scaffolding. Every signed-out page
      now renders through `AuthShell` (a brand/pitch pane plus a glass form
      card, `brand-mark.svelte`/`password-field.svelte`/
      `password-strength.svelte` extracted with it), the onboarding wizard is a
      centred column of headed panels over a connected step indicator, and
      `accept-invite` finally uses `enhanceToast` and the shared primitives
      instead of its own inputs. Killed the stale `LocalRun` branding and the
      `bg-bg` wrappers that were hiding the ambient backdrop.
- [x] Pangolin integration doesn't work. Every failure was swallowed into a
      `logger.warn` and the "Test connection" button only listed sites, so a
      configuration that could never create a resource passed it. The test now
      checks the whole set (token, named site, a registered domain covering the
      base domain), every list call pages instead of taking Pangolin's
      20-per-page default, and each deploy writes every provider's verdict into
      its own deployment log. The API base URL guidance was wrong too: it's the
      Integration API at `https://api.<host>/v1`, not the dashboard's `/api/v1`.
- [x] Domain mapping for the dashboard. The app container carried no Traefik
      labels in any compose file, so Homerun itself was only ever reachable on
      `:3000` while every service it deployed got a routed hostname. It now has
      a router keyed off one `DASHBOARD_DOMAIN` variable (compose.prod.yaml,
      tools/compose/app.compose.yaml and the installer's generated compose),
      quiet and self-signed when unset, real hostname plus a real certificate
      when set. A _service's_ custom domain was a second, separate problem: it
      is a Traefik label, written only when the container is created, so saving
      it did nothing to the running container and nothing said so. The
      Networking tab now shows that and offers a Redeploy button, and a deploy
      syncs DNS for the custom domain too, not just `<slug>.<baseDomain>`.
- [x] Forms on `/settings` blanked themselves after a save, and the compose
      import rejected the file its own preview had just parsed : one cause,
      `update()`'s default form reset against Svelte's stripped `value`
      attributes. `enhanceToast` no longer resets by default.
- [x] Deploy/redeploy hung forever on a plain-HTTP instance:
      `crypto.randomUUID()` is secure-context-only, so the deploy form's
      pre-submit callback threw before the request was ever sent.
- [x] [App] Onboarding drops the dashboard's port. Its Core step now prefills
      from the effective origin (a stored override, else `ORIGIN`) rather than
      from the portless base domain, so clicking through the defaults on an
      installer instance keeps `:3000` instead of persisting a port-80 URL over
      it. The "Use HTTPS" box follows the same source instead of defaulting on.
