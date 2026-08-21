import {
	deploy,
	ensureNetwork,
	inspectStatus,
	listManagedContainers,
	removeContainer,
	restartContainer,
	startContainer,
	stopContainer,
	streamLogs,
} from "./docker";
import { buildOpenApiDocument } from "./openapi";
import { deployInputSchema } from "./schemas";
import { getSystemStats } from "./stats";
import { tokensMatch } from "./token";
import { AGENT_VERSION } from "./version";

function json(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { "content-type": "application/json", ...init?.headers },
	});
}

/** Every route below /v1 requires this : health is deliberately the only unauthenticated route, so a monitor/load balancer can probe liveness without holding the token. */
function checkAuth(req: Request, token: string): boolean {
	const header = req.headers.get("authorization") ?? "";
	const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
	return presented.length > 0 && tokensMatch(presented, token);
}

export function createHandler(token: string) {
	return async function handle(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const path = url.pathname;

		if (path === "/v1/health" && req.method === "GET") {
			return json({ status: "ok", version: AGENT_VERSION });
		}

		// Same "public, doesn't expose data" stance as the main app's
		// /api/v1/openapi.json : the spec describes shapes, not data.
		if (path === "/v1/openapi.json" && req.method === "GET") {
			return json(buildOpenApiDocument(url.origin));
		}

		if (!checkAuth(req, token)) {
			return json({ error: "Unauthorized" }, { status: 401 });
		}

		try {
			if (path === "/v1/stats" && req.method === "GET") {
				return json(await getSystemStats());
			}

			if (path === "/v1/containers" && req.method === "GET") {
				return json(await listManagedContainers());
			}

			if (path === "/v1/deploy" && req.method === "POST") {
				const body = await req.json().catch(() => null);
				const parsed = deployInputSchema.safeParse(body);
				if (!parsed.success) {
					return json(
						{ error: "Invalid request body", issues: parsed.error.issues },
						{ status: 400 },
					);
				}
				const result = await deploy(parsed.data);
				return json(result);
			}

			const containerMatch = path.match(
				/^\/v1\/containers\/([^/]+)(\/(start|stop|restart|logs))?$/,
			);
			if (containerMatch) {
				const id = decodeURIComponent(containerMatch[1]);
				const action = containerMatch[3];

				if (!action && req.method === "GET") {
					return json(await inspectStatus(id));
				}
				if (!action && req.method === "DELETE") {
					await removeContainer(id);
					return json({ ok: true });
				}
				if (action === "start" && req.method === "POST") {
					await startContainer(id);
					return json({ ok: true });
				}
				if (action === "stop" && req.method === "POST") {
					await stopContainer(id);
					return json({ ok: true });
				}
				if (action === "restart" && req.method === "POST") {
					await restartContainer(id);
					return json({ ok: true });
				}
				if (action === "logs" && req.method === "GET") {
					const follow = url.searchParams.get("follow") === "true";
					const stream = await streamLogs(id, follow);
					return new Response(stream, {
						headers: { "content-type": "application/octet-stream" },
					});
				}
			}

			return json({ error: "Not found" }, { status: 404 });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return json({ error: message }, { status: 500 });
		}
	};
}

export { ensureNetwork };
