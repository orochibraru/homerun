# TODO

- Automate better auth secret generation (docker secret on setup, like the
  agent)
- Build a sexy docs website in Svelte
- UI test coverage: component tests (helper already scaffolded in `tests/app/`,
  not yet wired to any real component tests) + E2E tests with Playwright.
  `tests/integration/` (added alongside this item) covers the
  API/deploy-pipeline side only, deliberately not anything client-side
  interactive, see its own README's "Not covered" section.
