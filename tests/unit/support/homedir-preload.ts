import { mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

/**
 * Points `os.homedir()` at a scratch directory for the whole unit run, so no
 * test can read or write a real developer's home. `os.homedir()` is fixed for
 * the life of the process : it's read from the real OS environment at process
 * start, not re-read per call (verified : reassigning `process.env.HOME`
 * mid-process does *not* change what it returns), and a bunfig.toml
 * `[test].preload` script is the one place guaranteed to run before *any* test
 * file's own imports, so the override has to happen here rather than from
 * within a test file (see tests/README.md's "module mocks are process-global"
 * note).
 *
 * What still depends on it, now that the CLI is Go and keeps its own config
 * elsewhere: `config.ts`'s Docker-socket candidate list (both the app's and
 * the agent's) is built from `homedir()`, so without this a developer who
 * happens to have `~/.orbstack/run/docker.sock` would get different results
 * from one who doesn't.
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
