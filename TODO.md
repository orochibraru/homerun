# TODO

No priority, pick whatever.

- [ ] Pangolin integration doesn't work.
- [ ] [App] Onboarding drops the dashboard's port. Its Core step derives
      `authOrigin` from the base-domain field alone, prefilled from
      `config.baseDomain` (portless), so finishing the wizard on an installer
      instance reached at `http://<ip>:3000` persists `http://<ip>` over the
      correct `ORIGIN`. Sign-in still works (SvelteKit's ORIGIN env is separate)
      but the login wall's redirects and OAuth redirect URIs point at port 80.
      Prefill it from `config.auth.origin` instead.
- [ ] [App] No restore flow for S3 backups. Upload only; getting a tarball back
      into a volume is manual.
- [ ] [App] Compose import ignores `build:`, so those services land needing
      their Source tab pointed at a git repo by hand.
- [ ] [App] Cron jobs only run on the local daemon (`runOneOff` takes a remote
      connection, nothing passes one) and output only shows up after the run
      finishes.
- [ ] [Auth] Passkey + 2FA on the auth pages, and instance-level policies to
      require them.
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
- [ ] [Refactor] `deploy.service.ts` is ~700 lines over `buildSource` x
      `buildTarget.kind` x `orchestrationMode`. Most combinations are illegal
      and only rejected by a `throw` at the end of the pipeline, which is how
      the autoscale/swarm bug happened. Make the legal set a union instead.
- [ ] [Schema] `service` has 46 columns. The five auth-policy ones are the
      obvious extraction, but it touches the `policyVersion` HMAC,
      `gated-service-cache.ts`, `labels.ts` and a migration for no behaviour
      change. Ride along with the next change in that area, or close this.
