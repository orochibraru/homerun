# TODO

- [x] Automate better auth secret generation (docker secret on setup, like the
      agent): `packages/installer/steps/auth-secret.ts`'s `ensureAuthSecret`,
      wired into `--mode=full`'s `bringUpFullStack`, mirrors
      `packages/agent/token.ts`'s own "generate once, persist to a
      permission-tightened file" shape.
- [x] Build a sexy docs website in Svelte: `packages/docs-site/`, a standalone
      static SvelteKit site (`bun run dev:docs-site`/`build:docs-site`), see its
      own README. Renders `docs/*.md` at build time rather than duplicating that
      content. Not yet wired into the release pipeline / published anywhere,
      that's the natural next step here.
- [x] UI test coverage: component tests
      (`tests/unit/app/status-badge.test.ts`/`empty-state.test.ts`, its
      `svelte-loader.ts` scaffold now actually wired up, see that file's own
      comments for the two real Bun/Svelte-5 compatibility bugs fixing this
      surfaced) + E2E tests with Playwright (`tests/e2e/`, `bun run test:e2e`,
      real browser against a real built app + throwaway Postgres, see its own
      README, especially the note on why `global-setup.ts` has to spawn a
      separate `bun run` child process). `tests/integration/` covers the
      API/deploy-pipeline side only, deliberately not anything client-side
      interactive, see its own README's "Not covered" section.

## Thoughts on installer

Move to the init method of sveltekit so it creates everything Ask user to
install docker on their server themselves then run the containers? Would mean
the init methods starts the db containers and traefik itself. Would be nice for
updating. Maybe a bit of both? Small installer that just installs docker,
creates dirs, permissions and starts the main container which does the rest?
