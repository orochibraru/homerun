import { env } from "ENV";
import { getHandler } from "HANDLER";
import process from "node:process";

export const path = env("SOCKET_PATH", false);
export const host = env("HOST", "0.0.0.0");
export const port = env("PORT", "3000");

const body_size_limit = parse_as_bytes(env("BODY_SIZE_LIMIT", "512K"));
if (Number.isNaN(body_size_limit)) {
	throw new Error(
		`Invalid BODY_SIZE_LIMIT: '${env("BODY_SIZE_LIMIT", "512K")}'. Please provide a numeric value.`,
	);
}

const idle_timeout = Number.parseInt(env("IDLE_TIMEOUT", "10"), 10);
const { fetch: handlerFetch, routes, websocket } = getHandler();

// SERVE_OPTIONS (from svelte.config.js's adapter({ serveOptions })) spreads
// first so it can only add to or override fields this adapter doesn't
// itself own (tls, reusePort, maxConnections, a custom `error` handler,
// ...) : idleTimeout/maxRequestBodySize/fetch/routes/hostname-or-unix/
// websocket below always come after and win, so a careless serveOptions
// value can't break SvelteKit request handling through it. `routes` (static
// assets + prerendered pages, see handler.ts) takes precedence over `fetch`
// per-request by Bun's own routing rules : `fetch` here only ever runs for
// requests routes doesn't match, i.e. real SSR.
const options = {
	...SERVE_OPTIONS,
	fetch: handlerFetch,
	idleTimeout: idle_timeout,
	maxRequestBodySize: body_size_limit,
	routes,
	...(path ? { unix: path } : { hostname: host, port: port }),
	...(websocket ? { websocket } : {}),
};

// The unix-socket vs hostname/port branches above are a real discriminated
// union Bun.serve()'s overloads care about, but SERVE_OPTIONS (an arbitrary
// Record<string, unknown> by design, see index.ts) necessarily widens the
// inferred type past what those overloads accept. This cast is narrow (a
// real parameter type via Parameters<>, not `any`) and only papers over
// that widening, not a hole in the request-handling contract itself.
const server = Bun.serve(options as Parameters<typeof Bun.serve>[0]);

console.log(`Listening on ${server.url} ${websocket ? "with WebSocket" : ""}`);

// Two real, tested-in-review bugs this replaced :
//
// 1. `server.stop(true)` immediately force-closes every in-flight
//    connection (Bun's own docs : the `true` argument means exactly that,
//    `false`/no-argument is the graceful variant that waits for in-flight
//    requests to finish). A function named `graceful_shutdown` was doing
//    the opposite of graceful, verified against Bun's own `Server.stop()`
//    type/doc comment. This app in particular has several long-lived
//    streaming responses (the service Logs tab, System Logs, a live
//    deploy-progress poll) that a mid-response force-close would just cut.
// 2. Nothing ever called `process.exit()` after `server.stop()` resolved.
//    `CronService`'s three schedulers (`hooks.server.ts`'s `init()`) run on
//    plain `setInterval`s that are never `.unref()`'d, so they keep the
//    event loop alive indefinitely on their own : with the HTTP server
//    stopped but those still ticking, the process would never actually
//    exit, it'd just become unreachable over HTTP while still running in
//    the background until something (Docker/systemd's own kill-after-
//    timeout) SIGKILLs it. `process.exit()` below makes the "graceful"
//    shutdown actually a *shutdown*.
const shutdown_timeout_ms =
	Number.parseInt(env("SHUTDOWN_TIMEOUT", "30"), 10) * 1000;
let shutting_down = false;

async function graceful_shutdown(reason: "SIGINT" | "SIGTERM" | "IDLE") {
	if (shutting_down) {
		// Second signal while still draining : the standard "one more
		// Ctrl+C/kill to really stop now" escape hatch, for a request stuck
		// on something (an unreachable registry a pull is hanging against,
		// a client that never closes a log stream) that SHUTDOWN_TIMEOUT
		// hasn't caught yet.
		console.info(`Received ${reason} again, forcing immediate shutdown.`);
		process.exit(1);
	}
	shutting_down = true;

	console.info(
		`Stopping server (waiting up to ${shutdown_timeout_ms / 1000}s for in-flight requests to finish)...`,
	);
	process.emit("sveltekit:shutdown", reason);

	const force_timer = setTimeout(() => {
		console.warn(
			`Graceful shutdown exceeded ${shutdown_timeout_ms / 1000}s, forcing.`,
		);
		server.stop(true).finally(() => process.exit(1));
	}, shutdown_timeout_ms);

	await server.stop();
	clearTimeout(force_timer);
	console.info("Stopped server");
	process.exit(0);
}

process.on("SIGTERM", graceful_shutdown);
process.on("SIGINT", graceful_shutdown);

export { server };

/**
 * Parses the given value into number of bytes.
 *
 * @param value - Size in bytes. Can also be specified with a unit suffix kilobytes (K), megabytes (M), or gigabytes (G).
 */
function parse_as_bytes(value: string): number {
	const units = value.at(-1)?.toUpperCase();
	const multiplier =
		{
			B: 1,
			G: 1024 * 1024 * 1024,
			K: 1024,
			M: 1024 * 1024,
		}[units ?? "B"] ?? 1;
	return Number(multiplier !== 1 ? value.slice(0, -1) : value) * multiplier;
}
