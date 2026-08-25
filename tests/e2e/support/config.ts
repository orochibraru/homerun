/**
 * A fixed port/base URL, not a `getFreePort()`-resolved one like
 * `tests/integration/` uses for its own spawned app : Playwright's own
 * `use.baseURL` is read from `playwright.config.ts` at config-load time,
 * before `globalSetup` (which is what would otherwise resolve a free port)
 * ever runs, so the two can't agree on a dynamic value without a second
 * IPC round trip. A fixed port is the simpler tradeoff, at the cost of this
 * suite not being safe to run twice concurrently on the same machine (same
 * "known, documented limitation" posture this repo already takes elsewhere,
 * e.g. the swarm-join/remote-host groundwork's own untested-live caveats).
 */
export const E2E_PORT = 4310;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
