# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

- [ ] Security scanning is nice BUT we need the admin to configure scan policies
      like if there's at least one critical CVE block deployment. This can
      extend to high, medium or low.
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
- [ ] `InvitationDTO.listPending` returns expired invites (filters on
      `acceptedAt IS NULL` only), while `getByToken` treats them as invalid.
- [ ] `ServiceLifecycleService.deleteService` ignores `#detachWorkload`'s result
      and deletes the row anyway, so a failed detach leaves an orphaned
      container/swarm service with no signal to the caller.
- [ ] Duplicate helpers to collapse: `volumeNameFor` (`compose-import.ts`) vs
      `bindVolumeName` (`migrate/common.ts`); `splitRevisionRef`
      (`revisions.ts`) vs `splitImageRef` (`compose-import.ts`); the three
      `unique*Slug` helpers in `template-links.ts`.
- [ ] Root `tsconfig.json` excludes `tests`, so no gate type-checks the ~115
      test files. Dropping the exclude surfaces 25 errors in 9 files: the
      integration service fixtures miss `pullPolicy`, plus `async-block.test.ts`
      (snippet typing), `queue.test.ts` (overloads), `installer/exec.test.ts`
      (implicit any), `long-request.test.ts` (`Server` generic) and
      `support/git-fixture.ts`. Fix them, drop the exclude.
- [ ] `lint:tailwind` (tailwint) catches nothing in `.svelte` files: only 2 of
      ~240 files ever get LSP diagnostics, and a probe component with
      `class="p-4 p-2 flex block"` passes it (and biome's `useSortedClasses`).
      Make the Tailwind LSP see the Svelte files or drop tailwint.
- [ ] `AUTH_SECRET=` left empty, as `.env.example` ships it, gets past `??` in
      `config.ts`, so the app signs and encrypts with an empty key;
      `AdminService` only warns on `"default-secret"`. Treat empty as unset.
- [ ] Bun isn't pinned anywhere: CI's `oven-sh/setup-bun@v2` takes latest and
      `package.json` has no `packageManager`, while `bunfig.toml` and
      `.agents/notes/testing.md` document Bun-1.4.0-specific behaviour. Pin it
      (`packageManager` + `bun-version-file`).
- [ ] `.claude/settings.json`'s Stop hook runs `bun run test:e2e` (and
      `prek run`) at every hand-back. E2E needs a fresh `bun run build:app` and
      takes minutes, so it either tests a stale build or stalls every turn; move
      it to an explicit step.
