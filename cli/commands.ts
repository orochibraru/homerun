import type { makeClient } from "./client";
import { fail, printJson, printTable } from "./output";

type Client = ReturnType<typeof makeClient>;

async function unwrap<T>(
	promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
	const { data, error, response } = await promise;
	if (error !== undefined || !response.ok) {
		fail(
			`${response.status} ${response.statusText}: ${JSON.stringify(error ?? {})}`,
		);
	}
	return data as T;
}

export async function servicesList(
	client: Client,
	json: boolean,
): Promise<void> {
	const services = await unwrap(client.GET("/services"));
	if (json) {
		printJson(services);
		return;
	}
	printTable(
		(services as Record<string, unknown>[]).map((s) => ({
			id: s.id,
			image: `${s.image}:${s.tag}`,
			name: s.name,
			slug: s.slug,
			status: s.currentStatus,
		})),
		["id", "name", "slug", "status", "image"],
	);
}

export async function serviceGet(
	client: Client,
	id: string,
	json: boolean,
): Promise<void> {
	const svc = await unwrap(
		client.GET("/services/{serviceId}", {
			params: { path: { serviceId: id } },
		}),
	);
	printJson(json ? svc : svc);
}

export async function serviceAction(
	client: Client,
	action: "deploy" | "start" | "stop" | "restart",
	id: string,
): Promise<void> {
	const path = `/services/{serviceId}/${action}` as const;
	const result = await unwrap(
		// biome-ignore lint/suspicious/noExplicitAny: the four action paths share an identical {params:{path:{serviceId}}} shape but openapi-fetch's generated overloads don't unify across a template-literal path union.
		(client.POST as any)(path, { params: { path: { serviceId: id } } }),
	);
	printJson(result);
}

export async function projectsList(
	client: Client,
	json: boolean,
): Promise<void> {
	const projects = await unwrap(client.GET("/projects"));
	if (json) {
		printJson(projects);
		return;
	}
	printTable(
		(projects as Record<string, unknown>[]).map((p) => ({
			id: p.id,
			name: p.name,
			slug: p.slug,
		})),
		["id", "name", "slug"],
	);
}

export async function templatesList(
	client: Client,
	json: boolean,
): Promise<void> {
	const templates = await unwrap(client.GET("/templates"));
	if (json) {
		printJson(templates);
		return;
	}
	printTable(
		(templates as Record<string, unknown>[]).map((t) => ({
			id: t.id,
			image: `${t.image}:${t.tag}`,
			name: t.name,
		})),
		["id", "name", "image"],
	);
}
