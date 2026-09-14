# TODO

No priority, pick whatever.

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

- [x] Pangolin integration doesn't work. Every failure was swallowed into a
      `logger.warn` and the "Test connection" button only listed sites, so a
      configuration that could never create a resource passed it. The test now
      checks the whole set (token, named site, a registered domain covering the
      base domain), every list call pages instead of taking Pangolin's
      20-per-page default, and each deploy writes every provider's verdict into
      its own deployment log. The API base URL guidance was wrong too: it's the
      Integration API at `https://api.<host>/v1`, not the dashboard's `/api/v1`.
- [x] [App] Onboarding drops the dashboard's port. Its Core step now prefills
      from the effective origin (a stored override, else `ORIGIN`) rather than
      from the portless base domain, so clicking through the defaults on an
      installer instance keeps `:3000` instead of persisting a port-80 URL over
      it. The "Use HTTPS" box follows the same source instead of defaulting on.
