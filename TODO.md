# TODO

## Decisions needed

Each of these is blocked on a call, not on time. Answer it and the work below it
becomes schedulable.

- [ ] [Cron] Decide whether `cronMatches` should match standard cron. It ANDs
      day-of-month and weekday where cron ORs them when both are restricted, so
      `0 0 1 * 1` means "the 1st, and only if it's a Monday" instead of "the 1st
      or any Monday". Pinned as current behaviour by
      `tests/unit/app/cron-expression.test.ts`. Options : (a) implement the OR
      rule and update the test ; (b) keep the current semantics and say so in
      the schedule field's help text, since anyone pasting an expression from
      crontab.guru will otherwise get a schedule that silently never fires.
- [ ] [Schema] Decide when to split the `service` table, not whether. 46 columns
      : image config, git build config, registry credentials, SSL certs, network
      mode, cron schedule, autoscale flag, swarm replicas and a five-column auth
      policy on one row. The auth policy block (`authRequired`, `authProviders`,
      `authAllowedUserIds`, `authAllowedEmails`, `authAllowedGroups`) is the
      obvious first extraction, but it is purely organisational : it touches the
      login wall's `policyVersion` HMAC, `gated-service-cache.ts`, `labels.ts`
      and a live migration, for no behaviour change. Cheapest done as a rider on
      the next change that opens that area anyway ; the alternative is accepting
      the column count and closing this.

## Small

- [ ] [Docs] `CLAUDE.md`'s Autoscaling section still describes the swarm
      interaction as "untested, flagged not fixed" and tells the reader not to
      mark a swarm-mode service autoscale-eligible. That gap is closed (see
      Done) ; the section needs updating so it stops warning about a fixed bug.

## Medium

- [ ] [App] No restore flow for S3 backups (upload only) : retrieving a tarball
      and unpacking it back into a bind mount or a named volume is still manual.
- [ ] [App] Compose import ignores `build:` : a compose service built from a
      local Dockerfile is imported as a service that then needs its Source tab
      pointed at a git repo by hand.
- [ ] [App] Cron jobs run on the local Docker daemon only : `runOneOff` takes a
      remote connection but nothing passes one, so an image job can't be
      targeted at a Remote Host, and a run's output is only visible after it
      finishes (no live tail).
- [ ] Add security policies for an instance: require passkey, 2fa etc.. with
      passkey and 2fa support on auth pages.
- [ ] [Tests] Coverage is inverted relative to risk : pure transforms
      (`command-parse`, `service-link`, `deploy-phases`) are well covered while
      most of `src/lib/services/` has none. `secrets.ts` and
      `cron/cron-expression.ts` are now covered ; the next two that matter are
      `deploy.service.ts` (the core pipeline, ~700 lines, no test) and
      `app-access.service.ts` (decides who gets past the login wall).

## Large

- [ ] [Docker] Security scanning
- [ ] [SDKs] Terraform/Pulumi providers
- [ ] [SDKs] Github Actions & Gitlab CI presets to deploy easily (deterministic
      or not, should be a settings if the user wants latest or only tagged)
- [ ] [Arch] Make the swarm prerequisites first-class. The daemon must already
      be swarm-active (`docker swarm init`) and Traefik needs
      `--providers.docker.swarmMode=true` added by hand, both currently
      documented as manual one-time admin steps. Onboarding should check for
      them and say so, and `packages/installer/swarm-join.sh` still has no
      real-host verification.
- [ ] [Refactor] Make `deploy.service.ts`'s legal combinations a closed union.
      It is ~700 lines over a four-dimensional cross product : `buildSource` (2)
      x `deployTarget.kind` (3) x `buildTarget.kind` (3) x `orchestrationMode`
      (2). Most of the 36 combinations are illegal and rejected by a `throw` at
      runtime rather than made unrepresentable, which is exactly how the
      autoscale/swarm bug in Done became reachable : the invalid state was
      constructible and the only guard was a throw at the far end of the
      pipeline. Encoding the legal set as a union stops that class of bug
      instead of catching each instance. Depends on the placement-model decision
      above, which determines what the legal set actually is.

## Done

- [x] [Arch] Removed Remote Hosts as a deploy target. Services always deploy to
      this host; capacity comes from joining a node to the swarm. Gone :
      `service.remoteHostId`, the deploy-target picker, `resolveTarget`,
      `connectionFor`, `listDeployTargets`, `remote_host.isBuildServer` (every
      host is a build server now), the agent's `/v1/deploy` and
      `/v1/containers/*` endpoints and the ~250 lines of hand-mirrored Docker
      lifecycle behind them, and every remote branch in `deploy.service.ts`,
      `service-lifecycle.service.ts` and `docker/reconcile.ts`. Migration
      `drizzle/0022_shiny_shiva.sql` drops the two columns.
- [x] [Arch] Remote Hosts kept as build servers only. Swarm schedules workloads
      but does not build images, so a git-based service can still build
      elsewhere and publish through a build cache registry. A build server now
      always requires one, since the built image never shares a daemon with the
      deploy.
- [x] [Arch] Placement model decided : **swarm wins**. Capacity is added by
      joining a node to the swarm, not by registering a separate daemon as a
      deploy target. Remote Hosts survives as build infrastructure only (swarm
      does not build images), and autoscale-by-migration is removed outright,
      swarm's own scheduler does placement natively and better. Staged follow-on
      work is under Large.
- [x] [Arch] Removed autoscale-by-migration : the `AutoscaleScheduler`, its
      `hooks.server.ts` start call, the four `instance_settings.autoscale*`
      columns, `service.autoscaleEligible`, the Settings Autoscaling section,
      the Compute tab toggle, the Scheduling page panel, and every mention in
      `README.md` and `docs/`. Migration `drizzle/0021_nappy_the_renegades.sql`
      drops the five columns : review before applying, it is not reversible.
- [x] [Bug] Autoscale corrupted a swarm-mode service's row : the tick now no-ops
      entirely in swarm mode, and
      `ServiceDTO.listAutoscaleEligibleOnLocalHost()` excludes services with a
      `swarmServiceId`. Previously the scheduler picked one up, skipped the
      container removal (a swarm service has no `containerId`, so the old
      workload was left running), committed `remoteHostId`, and every deploy
      from then on threw "Swarm mode services can only be deployed locally",
      recoverable only by clearing the deploy target by hand. dec- [x] [Bug]
      `bun run lint` failed on `tests/unit/app/toast.test.ts`.
- [x] [Bug] `logger.ts` hardcoded `scope !== "Deploy"` to avoid double-notifying
      on deploy failures, matching a string literal in `deploy.service.ts` ;
      both now share `DEPLOY_LOG_SCOPE`. `BaseScheduler` also hardcoded
      `new Logger("Cron")` for every scheduler, which `JobWorker` had to
      hand-override ; the scope is now each scheduler's own `label`.
- [x] [Refactor] Three structurally identical cron schedulers
      (`CronRedeployScheduler`, `BackupScheduler`, `CronJobScheduler`) replaced
      by one generic `DueScheduler<T>` plus three configs in `cron.service.ts`.
      `BaseScheduler`'s HMR registry is keyed on `label` rather than
      `constructor.name`, which three instances of one class would have collided
      on : only the first would ever have started.
- [x] [Refactor] `BackupService` was an abstract base with no abstract members
      and exactly one subclass, taking its transport as a callback parameter.
      Merged into `s3-backup.service.ts`.
- [x] [Refactor] `CloudflareService` and `PangolinService` are now fanned out
      over one provider list in `dns.service.ts`, which also owns the
      `<project>-<slug>.<baseDomain>` formula that the deploy path and the
      service-delete action each derived by hand.
- [x] [Chore] Deleted `src/lib/filtering.ts` (no callers since list filtering
      moved server-side) and dropped the unwired `rustywind` dependency.
- [x] [Tests] `secrets.ts` (AES-256-GCM round trip, tampered ciphertext and auth
      tag, malformed input) and `cron/cron-expression.ts` (parsing, matching,
      the double-fire guard) now have unit tests. Both were uncovered ; between
      them they gate every `*Enc` column and every scheduled redeploy, backup
      and cron job.

## Decided, do not redo

- Writing both `app_log` and `notification` on an error-level log is correct,
  not redundant. `app_log` carries warn level and unattributed logs the bell
  never shows ; `notification` carries lifecycle events (deploy, create, start,
  stop) `app_log` never sees, plus read state and a per-user retention policy.
  Merging them would let the global 5000-row prune evict one user's
  notifications. The fragile part was the shared scope string, now fixed.
- `backup_run` and `cron_job_run` stay separate from `job`. Same row shape,
  different lifetime : `job` is transient queue state on a 7-day prune, the
  other two are user-browsable history with distinct columns (`sizeBytes` vs
  `exitCode`/`output`).
- No sweeping comment-deletion pass for CLAUDE.md's "No comments. Anywhere."
  That rule already says "don't do sweeping comment-deletion passes, just never
  add one". The ~2400 existing comment lines are grandfathered by the rule
  itself.
