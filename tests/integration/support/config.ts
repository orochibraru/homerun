/**
 * Static, non-port test-run constants only. Every port (the throwaway
 * Postgres container, the spawned app, the spawned agent, the socat proxy)
 * is resolved *dynamically* per run (see port.ts/postgres-container.ts,
 * wired together in setup.ts's `beforeAll`) rather than hardcoded here : a
 * fixed port is exactly what made two runs of this suite (two terminals, a
 * local run next to CI) collide, real finding from actually hitting that.
 * `setup.ts`'s `beforeAll` builds each spawned process's own explicit `env`
 * object with whatever port/DB URL it resolved that run, so nothing here
 * needs to touch this test process's own `process.env` at all.
 */
export const TEST_DB_NAME = "homerun_test";
export const TEST_AUTH_SECRET = "test-secret-not-for-real-use-0123456789abcdef";
export const TEST_BASE_DOMAIN = "test.local";
export const AGENT_TOKEN = "test-agent-token-0123456789";

/**
 * Captured here, at module load (during the preload phase, before any test
 * file's own `beforeEach` runs), not read as the ambient global at call
 * time : `tests/app/svelte-loader.ts` (loaded process-wide for every test
 * file in this whole repo via bunfig.toml, not just Svelte ones) registers
 * happy-dom's own `fetch`/`Request`/`Headers` in a `beforeEach`, which
 * enforces browser-style same-origin/CORS checks that reject a plain
 * server-to-server request as "cross-origin". Real finding from actually
 * running this suite (verified live, same root cause the agent/http.test.ts
 * suite already had to work around for its own `fetch()` calls) : every
 * fetch call in tests/integration/ must use this captured reference, not
 * the bare global, or it 404s/network-errors inside any `test()` body
 * (setup.ts's own calls, which all happen inside `beforeAll` — itself
 * registered before any test file's `beforeEach` fires — are unaffected
 * either way, but use this too for consistency).
 */
export const nativeFetch = fetch;
