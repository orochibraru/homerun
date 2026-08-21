# TODO

Open follow-up items, grouped by area. Checked items are done; see CLAUDE.md for
the architectural detail behind anything already built.

## Architecture

- [x] **Migrate static-method service classes to real OOP.** Reference example:
      `src/lib/services/docker.service.ts` : instead of importing loose functions, use
      a `BaseDockerService` extended/mixed into per-concern classes (`DockerNetwork`,
      `DockerImage`, `DockerTerminal`, etc.), merged into one `DockerService`. Apply
      the same treatment to every other service that currently just imports standard
      methods : `src/lib/services/cron.service.ts` was the other flagged example.
      Goal: real OOP throughout, not static barrels. (Noted in the repo's Claude
      settings as a standing convention : see CLAUDE.md's OOP section.)
- [ ] Add native Newt tunnel integration for Pangolion support and domain mapping
- [ ] Add Cloudflare integration for domain mapping

## Orchestration

- [ ] Convert to using docker swarm with docker stack deploy, easier to scale, easier to manage.

## API & Docs

- [x] Add a UI page with a Swagger/OpenAPI UI rendering `/api/v1/openapi.json`. —
      new `(protected)/api-docs/` page (own nav item), `swagger-ui-dist` as a real
      npm dependency (not a CDN script — self-hosted app, docs shouldn't need
      outbound internet), dynamically imported client-side only (SSR would crash
      on `window`/`document` otherwise). See CLAUDE.md's "API Docs page" section
      for what's verified (server-render checked live; no browser/e2e harness
      exists in this repo anymore to verify the client-side widget itself — see
      that section for why).
- [x] Move page-only routes that are actually API endpoints into `src/routes/api/v1/`
      : e.g. `src/routes/(protected)/system-stats` shouldn't live under the pages tree. —
      moved to `api/v1/system-stats/`, dashboard's poll updated, added to the
      OpenAPI registry, verified live (old path 404s, new path 401s-when-unauth
      the same as every other API route).
- [x] Build the CLI against the OpenAPI server using `openapi-fetch`. — already
      done in an earlier pass (`cli/`, see CLAUDE.md's "Homerun CLI" section) ;
      this item was re-added to this list before that was known/visible here.
      Regenerated `cli/src/generated/openapi-types.ts` this pass too, since the
      system-stats move above changed the API surface it's typed against.

## Auth

- [x] Fix OAuth provider registration : it currently doesn't work
      ("We can't register an oauth provider"). — **real, tested bug, found and
      fixed**: the Settings page's OAuth Providers row list (and, it turns out,
      two other forms with the identical shape — `services/new`'s env-var rows
      and the service Env Vars tab) declared their editable array with
      `$derived(...)` and then mutated it directly via `.push()`/`.splice()` — a
      `$derived` value is computed from its dependencies, not a mutable store,
      so "Add provider" did nothing observable. Fixed all three the same way:
      `$state` seeded once, resynced via `$effect` only when the underlying data
      actually changes (not every keystroke). `templates/new/+page.svelte`'s
      already-correct `$state` version of the same pattern was the proof this
      fix is right, not a guess — see CLAUDE.md's "The `$derived` + push/splice
      anti-pattern" section.

## Git providers & builds

- [ ] Let users pick a repo instead of pasting a URL: list repositories from a
      configured git provider, with "paste a URL" as a fallback for when no provider
      is configured.
- [ ] Support remote hosts as dedicated build servers, so builds don't load the
      main server.
- [ ] Add build-cache support via a Docker registry : new sidebar page to
      configure registries used for caching.

## UI / UX

- [ ] Add color coding throughout the UI so things are easier to visually locate.
- [ ] Build reusable components for listing entities two ways: card view and
      list view.
- [ ] Add submenus / proper categorization to the sidebar nav : needed once the
      page count below grows.

## SSL / Certificates

- [ ] Add an instance setting for the ACME account email (needed for cert
      generation), alongside the existing custom-cert support.

## Notifications

- [ ] Add a notification system: a bell icon in the header with a feed of
      events : new deployment, auto-update, start, stop, new service, deploy
      failures, app runtime failures.

## Storage & backups

- [ ] Add a page to configure S3 destinations for storage (mainly for backups).
- [ ] Add a dedicated backups page: configure per-volume backups and view a
      run log (when they ran, success/failure). Scheduled backups should also
      surface on the cron page below.

## Scheduling

- [ ] Add a cron scheduler page (surfacing cron-redeploy, backup, and autoscale
      scheduler activity in one place).

## Release & documentation

- [x] Set up release automation with semantic-release to start versioning the
      app (starting at 0.1.0-alpha.1, moving slowly — see the note below about
      the accidental first v1.0.0 release). — `.releaserc.json` +
      `scripts/bump-version.ts`/`scripts/build-release-binaries.ts` + a new
      `release` job in `.github/workflows/publish.yaml`, conventional-commit
      driven (this repo's commits already use `feat:`/`fix:`/`chore:`). Uses
      `@saithodev/semantic-release-gitea`, not the official GitHub plugin —
      this repo's real remote is a self-hosted Gitea, not GitHub, even though
      workflows live under `.github/workflows/`. Attaches all six
      agent/installer/cli Linux binaries (x64+arm64) as release assets,
      directly covering the "installer (and Homerun Agent) in each release
      artifact" half of the item below. See CLAUDE.md's "Release automation"
      section for exactly what's verified (both scripts run for real locally;
      `semantic-release --dry-run` confirmed the whole config/plugin chain
      resolves and reaches the real Gitea API before failing on a
      deliberately-fake token) vs. not (an actual CI release run, and whether
      the reused `PACKAGES_TOKEN` has release-API scope, not just registry-push).
      **Real, corrected mistake**: the first real CI run published `v1.0.0` —
      semantic-release always ships the very first release as `1.0.0`
      regardless of commit types, that's not something `branches`/commit
      config controls. Fixed by deleting that Gitea release + tag by hand
      (`tea releases delete`), resetting all four `package.json` versions to
      `0.1.0-alpha.1`, seeding a matching `v0.1.0-alpha.1` git tag as the new
      baseline, and marking `main` itself as a `prerelease: "alpha"` branch in
      `.releaserc.json` so every release going forward tags as
      `0.1.0-alpha.N`/`0.2.0-alpha.N`/etc. until a deliberate decision to cut
      a stable release.
- [x] Rewrite the README to showcase features and print a ready-to-run curl
      setup command. — full rewrite: a "Why Homerun" pitch, the installer
      one-liner (real repo URL, `--mode=full`) as the headline quick-start
      plus a from-source/compose path underneath, the full feature list
      pulled from CLAUDE.md's architecture sections, and pointers to the new
      `docs/` tree and the three sub-projects. Also added `.env.example` at
      the repo root (wasn't checked in before — every var cross-referenced
      against `src/lib/config.ts`, `.gitignore` already allow-listed it).
- [x] Build a docs website. Create MD file or event mdx in a "docs" directory at the root of the repo and we'll build some pages from there later. The goal for now is to have docs in the repo. — `docs/` added: an index plus
      nine guides (getting started, configuration, services, projects &
      templates, storage & backups, remote hosts & the Homerun Agent, users
      & access, API & CLI, FAQ & limitations) — user/operator-facing, a step
      down in density from CLAUDE.md, which stays the contributor-facing
      counterpart. No site generator wired up yet, per the item's own scope
      cut — plain Markdown, readable straight from the repo or a Gitea/GitHub
      file browser.

## Environment variables

- [ ] Support pasting a `.env` file into the Environment field, auto-populating
      one env var row per line.
