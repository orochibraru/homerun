# TODO

## Bugs

- [ ] [Bug] Autoscale corrupts a swarm-mode service's row :
      `ServiceDTO.listAutoscaleEligibleOnLocalHost()` doesn't exclude swarm
      services, so `AutoscaleScheduler.migrateToOverflow()` picks one up, skips
      the container removal (a swarm service carries `swarmServiceId`, not
      `containerId`, so the `if (svc.containerId)` guard is false and the old
      workload is left running), commits `remoteHostId`, and from then on every
      deploy throws "Swarm mode services can only be deployed locally". Silent,
      and only recoverable by clearing the deploy target by hand. Fix is one
      `isNull(service.swarmServiceId)` in that query.
- [ ] [Bug] `bun run lint` fails : `tests/unit/app/toast.test.ts:43` trips
      biome's `useErrorMessage` on a deliberately-empty `new Error("")`.
      `new Error()` with no argument tests the same thing and passes. The repo's
      own gate rule says lint must be clean, so the gate is currently lying.
- [ ] [Bug] `logger.ts` hardcodes `scope !== "Deploy"` to avoid double-notifying
      on deploy failures, matching `new Logger("Deploy")` in
      `deploy.service.ts`. Renaming that scope string silently double-notifies
      every deploy failure, and nothing tests it. Related: all four schedulers
      log through `BaseScheduler`'s shared `new Logger("Cron")`, so
      `app_log.scope` can't tell Backup from Autoscale from JobWorker apart.

## Small

- [ ] [Chore] Delete `src/lib/filtering.ts` : 20 lines, zero callers since list
      filtering moved server-side.
- [ ] [Chore] Drop the `rustywind` dependency : unwired, superseded by
      `tailwint` for Tailwind class sorting.
- [ ] [Chore] Collapse `BackupService` into `S3BackupService` : an abstract base
      with exactly one subclass. Re-split when a second transport exists.

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
- [ ] [Refactor] Three cron schedulers are structurally the same file :
      `CronRedeployScheduler`, `BackupScheduler` and `CronJobScheduler` differ
      only in DTO, schedule field, last-run field and enqueue function. One
      generic scheduler plus three short configs replaces ~105 lines with ~55.
- [ ] [Refactor] Six append-only history stores with the same shape :
      `deployment`, `backup_run`, `cron_job_run`, `job`, `app_log` and
      `notification`, each with its own DTO, prune policy and page. `job`
      already carries status/attempts/error/result/startedAt/finishedAt and
      already runs backups and cron jobs, so `backup_run` and `cron_job_run` are
      close to redundant with it.
- [ ] [Refactor] `app_log` and `notification` are both written on every
      error-level log : two writes, two prune policies and two UIs for one
      event, held apart only by the hardcoded scope check above.
- [ ] [Refactor] `CloudflareService` and `PangolinService` have an identical
      public surface (`syncDnsRecord`/`deleteDnsRecord`/`verify*`) with no
      shared type, and `deploy.service.ts` fire-and-forgets both
      unconditionally. One loop over a provider array replaces the hand-written
      call pairs in the deploy path and in the service-delete action.
- [ ] [Tests] 23 modules under `src/lib/services/` have no test, including
      `secrets.ts` (the AES-256-GCM module every `*Enc` column depends on) and
      `deploy.service.ts` (712 lines, the core pipeline). Meanwhile pure
      transforms like `command-parse` and `service-link` are well covered :
      coverage is inverted relative to risk.
- [ ] [Docs] 2414 comment lines across 142 of 400 files, against CLAUDE.md's "No
      comments. Anywhere. In any code file." Either delete them or drop the rule
      : right now a new contributor is told one thing and shown another.

## Large

- [ ] [Docker] Security scanning
- [ ] [SDKs] Terraform/Pulumi providers
- [ ] [SDKs] Github Actions & Gitlab CI presets to deploy easily (deterministic
      or not, should be a settings if the user wants latest or only tagged)
- [ ] [Schema] `service` has 46 columns : image config, git build config,
      registry credentials, SSL certs, network mode, cron schedule, autoscale
      flag, swarm replicas and a five-column auth policy all on one row. The
      auth policy block (`authRequired`, `authProviders`, `authAllowedUserIds`,
      `authAllowedEmails`, `authAllowedGroups`) is the clearest candidate to
      split out first.
- [ ] [Refactor] `deploy.service.ts` is 712 lines over a four-dimensional cross
      product : `buildSource` (2) x `deployTarget.kind` (3) x `buildTarget.kind`
      (3) x `orchestrationMode` (2). Most of the 36 combinations are illegal and
      rejected by a `throw` at runtime rather than made unrepresentable, which
      is exactly how the autoscale bug above became reachable.
- [ ] [Arch] Three placement models that don't compose : Remote Hosts, Swarm
      mode and Autoscale migration each ship with their own documented
      architectural limitation (remote hosts get no Traefik, no shared network
      and no bind mounts ; swarm is local-manager-only ; autoscale migrates
      rather than replicates) and none of them combines with the others. Decide
      which one is the real answer before adding a fourth.
- [ ] [UX] 18 sidebar items for a self-described minimal alternative : S3
      Destinations, Build Cache, Git Providers, Backups and Scheduling are each
      a top-level nav entry backed by one small table. Candidates for folding
      into the pages that actually use them.
