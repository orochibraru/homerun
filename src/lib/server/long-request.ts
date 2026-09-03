/**
 * Disables Bun's per-connection idle timeout for one in-flight request.
 *
 * `@orochibraru/svelte-smol`'s server passes `idleTimeout` to `Bun.serve()`,
 * defaulting to 10s (env `IDLE_TIMEOUT`), and Bun applies it to a request
 * that's still being handled, not just to a genuinely idle socket: a handler
 * that produces no bytes for longer than that has its connection severed
 * mid-flight, which the caller sees as a bare `ECONNRESET` rather than a
 * response. A GET is transparently retried by most clients so it usually only
 * looks slow, a POST is not, so it just fails.
 *
 * Real, reproduced finding, not a precaution: `POST /api/v1/services/<id>/stop`
 * awaits `docker stop`, whose SIGKILL grace period is itself 10s, so any
 * container that doesn't exit on its stop signal promptly puts the request
 * right at the timeout boundary. Verified on Linux/Bun 1.4.0 (the macOS build
 * doesn't enforce it the same way, which is why it only ever failed in CI):
 * with `idleTimeout: 10`, a 15s POST handler fails with `ECONNRESET` at ~12s,
 * and calling this first makes the same handler return 200 at 15s.
 *
 * Call it at the top of any handler that can legitimately outlast that window:
 * container lifecycle operations, image pulls/git builds, and long-lived log
 * or terminal streams. `platform` is undefined under `vite dev` (no Bun server
 * to address), where the timeout doesn't apply either, so this is a no-op.
 */
export function allowLongRequest(platform: App.Platform | undefined): void {
	platform?.server.timeout(platform.request, 0);
}
