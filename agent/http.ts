import type { BunRequest } from "bun";
import { DockerService } from "./docker";
import { OpenApiBuilder } from "./openapi";
import { buildInputSchema, deployInputSchema } from "./schemas";
import { SystemStatsService } from "./stats";
import { tokensMatch } from "./token";
import { AGENT_VERSION } from "./version";

function json(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { "content-type": "application/json", ...init?.headers },
	});
}

type RouteHandler<Path extends string> = (
	req: BunRequest<Path>,
) => Response | Promise<Response>;

/**
 * Real instance state (the bearer token every request has to present),
 * routed through instance methods instead of a factory closure : `routes` is
 * a getter built fresh from `this`, and `#authed` closes over `this.token`,
 * so `Bun.serve({ routes: server.routes, fetch: server.notFound })` keeps
 * working without any `.bind(server)` at the call site.
 */
export class AgentHttpServer {
	constructor(private readonly token: string) {}

	/**
	 * Bun's native route table (`Bun.serve({ routes })`), method-keyed per
	 * path with `:param` segments parsed for us, instead of the manual
	 * `path === ...`/regex matching this used to do by hand. `/v1/health` and
	 * `/v1/openapi.json` are the only unauthenticated routes (same "spec
	 * describes shapes, not data" stance as the main app's, and health has to
	 * stay open so a monitor/load balancer can probe liveness without holding
	 * the token); every other route is wrapped in `#authed`, which also
	 * centralizes the try/catch → 500 behavior the old switch had inline.
	 */
	get routes() {
		return {
			"/v1/build": {
				POST: this.#authed(async (req) => {
					const body = await req.json().catch(() => null);
					const parsed = buildInputSchema.safeParse(body);
					if (!parsed.success) {
						return json(
							{ error: "Invalid request body", issues: parsed.error.issues },
							{ status: 400 },
						);
					}
					const result = await DockerService.buildFromGit(parsed.data);
					return json(result, { status: result.success ? 200 : 500 });
				}),
			},
			"/v1/containers": {
				GET: this.#authed(async () =>
					json(await DockerService.listManagedContainers()),
				),
			},
			"/v1/containers/:id": {
				DELETE: this.#authed<"/v1/containers/:id">(async (req) => {
					await DockerService.removeContainer(
						decodeURIComponent(req.params.id),
					);
					return json({ ok: true });
				}),
				GET: this.#authed<"/v1/containers/:id">(async (req) =>
					json(
						await DockerService.inspectStatus(
							decodeURIComponent(req.params.id),
						),
					),
				),
			},
			"/v1/containers/:id/logs": {
				GET: this.#authed<"/v1/containers/:id/logs">(async (req) => {
					const follow = new URL(req.url).searchParams.get("follow") === "true";
					const stream = await DockerService.streamLogs(
						decodeURIComponent(req.params.id),
						follow,
					);
					return new Response(stream, {
						headers: { "content-type": "application/octet-stream" },
					});
				}),
			},
			"/v1/containers/:id/restart": {
				POST: this.#authed<"/v1/containers/:id/restart">(async (req) => {
					await DockerService.restartContainer(
						decodeURIComponent(req.params.id),
					);
					return json({ ok: true });
				}),
			},
			"/v1/containers/:id/start": {
				POST: this.#authed<"/v1/containers/:id/start">(async (req) => {
					await DockerService.startContainer(decodeURIComponent(req.params.id));
					return json({ ok: true });
				}),
			},
			"/v1/containers/:id/stop": {
				POST: this.#authed<"/v1/containers/:id/stop">(async (req) => {
					await DockerService.stopContainer(decodeURIComponent(req.params.id));
					return json({ ok: true });
				}),
			},
			"/v1/deploy": {
				POST: this.#authed(async (req) => {
					const body = await req.json().catch(() => null);
					const parsed = deployInputSchema.safeParse(body);
					if (!parsed.success) {
						return json(
							{ error: "Invalid request body", issues: parsed.error.issues },
							{ status: 400 },
						);
					}
					return json(await DockerService.deploy(parsed.data));
				}),
			},
			"/v1/health": {
				GET: () => json({ status: "ok", version: AGENT_VERSION }),
			},
			"/v1/openapi.json": {
				GET: (req: BunRequest) =>
					json(OpenApiBuilder.buildDocument(new URL(req.url).origin)),
			},
			"/v1/stats": {
				GET: this.#authed(async () =>
					json(await SystemStatsService.getSystemStats()),
				),
			},
		};
	}

	/** Fallback for any request Bun's router couldn't match against `routes` above. */
	notFound = (): Response => json({ error: "Not found" }, { status: 404 });

	/**
	 * Wraps a route handler with the bearer-token check, request logging,
	 * and the shared error → 500 JSON translation every authenticated route
	 * needs. Real gap this closes : every one of these routes (deploy,
	 * build, start/stop/restart, ...) used to print nothing at all to this
	 * process's own console, so a request that reached the agent and did
	 * real work (or failed) left zero trace in its own logs, the only
	 * evidence was whatever the *caller* (the main app) happened to show.
	 * `/v1/health` deliberately isn't logged here (it doesn't go through
	 * `#authed` at all) : a monitor/the Remote Hosts page's own live status
	 * check can poll it every few seconds, which would otherwise drown out
	 * everything else.
	 */
	#authed<Path extends string>(
		handler: RouteHandler<Path>,
	): RouteHandler<Path> {
		return async (req) => {
			const start = performance.now();
			const { pathname } = new URL(req.url);
			if (!this.#checkAuth(req)) {
				console.log(`[http] ${req.method} ${pathname} - 401`);
				return json({ error: "Unauthorized" }, { status: 401 });
			}
			try {
				const res = await handler(req);
				console.log(
					`[http] ${req.method} ${pathname} - ${res.status} (${Math.round(performance.now() - start)}ms)`,
				);
				return res;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.log(
					`[http] ${req.method} ${pathname} - 500 (${Math.round(performance.now() - start)}ms): ${message}`,
				);
				return json({ error: message }, { status: 500 });
			}
		};
	}

	#checkAuth(req: Request): boolean {
		const header = req.headers.get("authorization") ?? "";
		const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
		return presented.length > 0 && tokensMatch(presented, this.token);
	}
}
