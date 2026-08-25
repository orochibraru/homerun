import type { ClientFactory } from "./client";
import { Output } from "./output";

type Client = ReturnType<typeof ClientFactory.makeClient>;

/** Every command takes the already-built `Client` as an argument rather than owning one itself : this class holds no client of its own, it's grouped for consistency with every other cli/ module, not because it carries state. */
class CliCommands {
	async servicesList(client: Client, json: boolean): Promise<void> {
		const services = await this.#unwrap(client.GET("/services"));
		if (json) {
			Output.printJson(services);
			return;
		}
		Output.printTable(
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

	async serviceGet(client: Client, id: string): Promise<void> {
		const svc = await this.#unwrap(
			client.GET("/services/{serviceId}", {
				params: { path: { serviceId: id } },
			}),
		);
		Output.printJson(svc);
	}

	async serviceAction(
		client: Client,
		action: "deploy" | "start" | "stop" | "restart",
		id: string,
	): Promise<void> {
		const path = `/services/{serviceId}/${action}` as const;
		const result = await this.#unwrap(
			// biome-ignore lint/suspicious/noExplicitAny: the four action paths share an identical {params:{path:{serviceId}}} shape but openapi-fetch's generated overloads don't unify across a template-literal path union.
			(client.POST as any)(path, { params: { path: { serviceId: id } } }),
		);
		Output.printJson(result);
	}

	async projectsList(client: Client, json: boolean): Promise<void> {
		const projects = await this.#unwrap(client.GET("/projects"));
		if (json) {
			Output.printJson(projects);
			return;
		}
		Output.printTable(
			(projects as Record<string, unknown>[]).map((p) => ({
				id: p.id,
				name: p.name,
				slug: p.slug,
			})),
			["id", "name", "slug"],
		);
	}

	async templatesList(client: Client, json: boolean): Promise<void> {
		const templates = await this.#unwrap(client.GET("/templates"));
		if (json) {
			Output.printJson(templates);
			return;
		}
		Output.printTable(
			(templates as Record<string, unknown>[]).map((t) => ({
				id: t.id,
				image: `${t.image}:${t.tag}`,
				name: t.name,
			})),
			["id", "name", "image"],
		);
	}

	async #unwrap<T>(
		promise: Promise<{ data?: T; error?: unknown; response: Response }>,
	): Promise<T> {
		const { data, error, response } = await promise;
		if (error !== undefined || !response.ok) {
			Output.fail(
				`${response.status} ${response.statusText}: ${JSON.stringify(error ?? {})}`,
			);
		}
		return data as T;
	}
}

export const Commands = new CliCommands();
