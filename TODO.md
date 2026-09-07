# TODO

Sizes are rough. No priority, pick whatever.

## Medium

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

## Large

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

## Done

- [x] [Bug] `docs/remote-hosts-and-agent.md` linked to `services.md#git-builds`,
      a heading that no longer exists, which failed the docs image build (the
      only job that prerenders). Points at the Source-tab section now, and says
      where build cache registries actually live.
- [x] [Bug] Every real deploy failed on a host where the shared `homerun`
      network didn't exist (all of CI, any non-compose install, and any instance
      after a Docker Cleanup network prune). `createAndStartContainer` now
      ensures it, alongside the per-project one.
- [x] [Docs] Docs-sync pass over the Remote Hosts removal: `CLAUDE.md`'s Remote
      hosts section is now Build servers, and the agent, swarm, data model,
      queue and Planned-features sections stopped describing remote deploys.
      Same for `docs/faq-and-limitations.md`, `docs/storage-and-backups.md`,
      `docs/configuration.md` and `tests/integration/README.md`.
- [x] [Chore] Deleted the agent's `dockerNetworkName`/`HOMERUN_NETWORK_NAME`,
      dead since the agent stopped creating containers.
- [x] [Cron] `cronMatches` now applies the standard OR rule for day-of-month and
      weekday when both are restricted, with Vixie's star-flag semantics (`*/2`
      counts as unrestricted).
- [x] [Docs] Deleted `CLAUDE.md`'s Autoscaling section and every remaining
      autoscale/`CronRedeployScheduler`/`BackupScheduler` reference; the
      Schedulers section describes the actual `DueScheduler<T>` shape.
- [x] [Bug] `AgentClientService.verifyToken` still probed `/v1/containers`,
      removed with the agent's deploy routes, so registering an agent-kind
      remote host always failed. It hits `/v1/stats` now.
- [x] [Arch] Placement is swarm, not Remote Hosts. Capacity comes from joining a
      node to the swarm. Removed `service.remoteHostId`, the deploy-target
      picker, `resolveTarget`, `connectionFor`, `listDeployTargets`, the agent's
      `/v1/deploy` and `/v1/containers/*`, and every remote branch in
      `deploy.service.ts`, `service-lifecycle.service.ts` and
      `docker/reconcile.ts`. Migration `drizzle/0022_shiny_shiva.sql`.
- [x] [Arch] Remote Hosts survives as build servers only (swarm does not build
      images). A build server now always needs a cache registry, since the built
      image never shares a daemon with the deploy.
- [x] [Arch] Removed autoscale-by-migration entirely: the scheduler, the five
      columns, the Settings section, the Compute toggle, the Scheduling panel
      and the docs. Migration `drizzle/0021_nappy_the_renegades.sql` is not
      reversible.
- [x] [Bug] Autoscale corrupted swarm-mode services: it committed `remoteHostId`
      without removing the old workload, and every deploy after that threw.
      Fixed before the feature was removed.
- [x] [Bug] `logger.ts` matched `scope !== "Deploy"` against a string literal in
      `deploy.service.ts`; both share `DEPLOY_LOG_SCOPE` now. `BaseScheduler`
      hardcoded `new Logger("Cron")`, it uses each scheduler's `label`.
- [x] [Bug] `bun run lint` failed on `tests/unit/app/toast.test.ts`.
- [x] [Refactor] Three identical cron schedulers replaced by one generic
      `DueScheduler<T>` plus three configs. `BaseScheduler`'s HMR registry keys
      on `label`, not `constructor.name`, which three instances of one class
      would have collided on.
- [x] [Refactor] `BackupService` was an abstract base with no abstract members
      and one subclass. Merged into `s3-backup.service.ts`.
- [x] [Refactor] Cloudflare and Pangolin fan out over one provider list in
      `dns.service.ts`, which also owns the hostname formula both the deploy
      path and the delete action used to derive by hand.
- [x] [Chore] Deleted `src/lib/filtering.ts` and the unwired `rustywind` dep.
- [x] [Tests] `secrets.ts` and `cron/cron-expression.ts` now have unit tests.

## Decided, do not redo

- `app_log` and `notification` stay separate. `app_log` has warn-level and
  unattributed logs the bell never shows; `notification` has lifecycle events,
  read state and per-user retention. Merging lets the 5000-row prune evict a
  user's notifications.
- `backup_run` and `cron_job_run` stay separate from `job`. Same shape,
  different lifetime: `job` is queue state on a 7-day prune, those two are
  browsable history.
- No comment-deletion pass. The rule says never add one, not remove the existing
  ones.
