import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { UpdateService } from "../../../packages/cli/update";

/**
 * `UpdateService.update()` is heavily side-effecting past its first guard clauses (real
 * network calls to Gitea, replacing the running binary), so this only
 * exercises the fast, deterministic fail-fast paths that are actually true
 * in every environment this suite runs in : `bun test` always runs via the
 * `bun` runtime itself (never a `bun build --compile`d binary).
 *
 * `fail()` (cli/output.ts) is typed `never` because it calls `process.exit`,
 * which truly never returns in production ; a no-op `process.exit` mock
 * would let execution fall through to the *next* guard (and eventually a
 * real network call), so the mock here throws instead, faithfully modeling
 * "this call never returns" for the purposes of this test.
 */
class ExitCalled extends Error {
	constructor(public code: number) {
		super(`process.exit(${code})`);
	}
}

describe("update", () => {
	afterEach(() => {
		mock.restore();
	});

	test("fails fast without any network calls, on whichever guard applies to this environment", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(
			() => undefined,
		);
		spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new ExitCalled(code ?? 0);
		}) as never);
		const fetchSpy = spyOn(globalThis, "fetch");

		await expect(UpdateService.update()).rejects.toThrow(ExitCalled);

		expect(fetchSpy).not.toHaveBeenCalled();
		const message = errorSpy.mock.calls[0]?.[0] as string;
		if (process.platform !== "linux") {
			expect(message).toContain("only supports Linux");
		} else {
			// Running via `bun test`, process.execPath is the `bun` runtime
			// itself, never a compiled `homerun` binary.
			expect(message).toContain("only works on the installed binary");
		}
	});
});
