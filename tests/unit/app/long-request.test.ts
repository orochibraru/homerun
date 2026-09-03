import { describe, expect, mock, test } from "bun:test";
import { allowLongRequest } from "../../../src/lib/server/long-request";

/**
 * Guards the one thing this helper exists for: clearing Bun's per-request
 * idle timeout, which `@orochibraru/svelte-smol` sets to 10s by default and
 * which severed `POST /api/v1/services/<id>/stop` mid-flight in CI whenever
 * `docker stop` used its full 10s SIGKILL grace. `0` means "no timeout" —
 * any other value would reintroduce a boundary for a request whose length is
 * bounded by a container's shutdown, not by this app.
 */
describe("allowLongRequest", () => {
	test("clears the request's idle timeout", () => {
		const timeout = mock(() => {});
		const request = new Request("http://localhost/api/v1/services/x/stop");
		allowLongRequest({
			request,
			server: { timeout } as unknown as Bun.Server,
		});
		expect(timeout).toHaveBeenCalledWith(request, 0);
	});

	test("is a no-op without a platform (vite dev has no Bun server)", () => {
		expect(() => allowLongRequest(undefined)).not.toThrow();
	});
});
