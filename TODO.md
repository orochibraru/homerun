# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

- [ ] `/system-logs/traefik` (the Traefik log stream) and the `/system-logs`
      page load only check for a signed-in user, not `locals.isAdmin`: a
      developer account can stream Traefik logs by URL even though the nav and
      the other log endpoints are admin-only.
- [ ] A status page's public link (`status-pages/[statusPageId]`) is built as
      `https://<baseDomain>/status/<slug>`, but `/status/[slug]` is served by
      the dashboard, so it should use the Dashboard URL (`config.auth.origin`);
      wrong whenever the two differ.
- [ ] `packages/installer/swarm-join.sh`'s own usage comment shows
      `--token <X> --manager <Y>`, but its parser only accepts `--token=` /
      `--manager=`, so the space-separated form fails with "unknown argument".
      Docs now use the `=` form; accept both or fix the comment.
- [ ] `auth.oauthProviders` is accepted in `homerun.yaml` (and in
      `homerun.schema.json`), but `applyAuthOverride` always prefers the DB
      column, which is `NOT NULL DEFAULT []`, so the file value never takes
      effect. Drop it from the schema or treat an empty DB list as unset.
- [ ] `service.uptimeEnabled` has no toggle in the UI or the REST API, so the
      Observability tab's "Uptime probing is off" state is unreachable.
- [ ] `homerun logout` (`packages/cli/login.ts`) only deletes the local config
      file; the API key stays valid on the server. Revoke it too.
- [ ] Arch detection disagrees: the installer's `detect.ts` `arch()` maps any
      non-arm64 host to `amd64`, while the CLI's `update.ts` exits on anything
      but x64/arm64.
- [ ] `waitForDatabase` in `src/hooks.server.ts` retries 10 times but only logs
      when `i % 10 === 0`, so only the first attempt is ever logged.
- [ ] `InvitationDTO.listPending` returns expired invites (filters on
      `acceptedAt IS NULL` only), while `getByToken` treats them as invalid.
- [ ] `ServiceLifecycleService.deleteService` ignores `#detachWorkload`'s result
      and deletes the row anyway, so a failed detach leaves an orphaned
      container/swarm service with no signal to the caller.
- [ ] Duplicate helpers to collapse: `volumeNameFor` (`compose-import.ts`) vs
      `bindVolumeName` (`migrate/common.ts`); `splitRevisionRef`
      (`revisions.ts`) vs `splitImageRef` (`compose-import.ts`); the three
      `unique*Slug` helpers in `template-links.ts`.
