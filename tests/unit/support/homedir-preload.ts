import { mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

/**
 * `cli/config.ts` resolves its config directory from `os.homedir()` once,
 * at module load (`const CONFIG_DIR = join(homedir(), ...)`), and
 * `os.homedir()` itself is fixed for the life of the process : it's read
 * from the real OS environment at process start, not re-read per call
 * (verified : reassigning `process.env.HOME` mid-process does *not* change
 * what it returns). A bunfig.toml `[test].preload` script is the one place
 * guaranteed to run before *any* test file's own imports, so mocking
 * `node:os`'s `homedir()` here, once, for the whole run, keeps every
 * `cli/config.ts` import in the suite (direct, or transitive via
 * `cli/client.ts`/`cli/login.ts`) pointed at a scratch directory instead of
 * a real developer's `~/.config/homerun`, regardless of which test file
 * happens to import it first — no more reliable a boundary exists once the
 * test run has actually started (see tests/README.md's "module mocks are
 * process-global" note), so this has to happen before that, not from within
 * any individual test file.
 *
 * Only `homedir()` is overridden ; every other `node:os` export (`cpus()`,
 * `totalmem()`, etc., used for real by agent/stats.ts) is passed through
 * unchanged, for both the named-import and default-import styles used
 * across this repo (verified : `import os from "node:os"` and
 * `import { homedir } from "node:os"` both see the override, everything
 * else keeps working).
 */
const fakeHome = mkdtempSync(join(os.tmpdir(), "homerun-test-home-"));

mock.module("node:os", () => ({
	...os,
	default: {
		...(os as unknown as { default?: object }).default,
		homedir: () => fakeHome,
	},
	homedir: () => fakeHome,
}));
