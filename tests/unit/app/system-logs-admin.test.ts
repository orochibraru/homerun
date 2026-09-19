import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

mock.module("$app/paths", () => ({
	resolve: (path: string) => path,
}));

let streamed = false;
let traefikFailure: unknown = null;
let traefikCalls: string[] = [];

const { DockerService } = await import(
	"../../../src/lib/services/docker.service"
);

beforeEach(() => {
	stub(DockerService, "listInfraContainers", async () => [{ id: "traefik" }]);
	stub(DockerService, "restartTraefikContainer", async () => {
		traefikCalls.push("restart");
		if (traefikFailure) {
			throw traefikFailure;
		}
	});
	stub(DockerService, "streamLogs", async () => {
		streamed = true;
		return new ReadableStream();
	});
	stub(DockerService, "updateTraefikContainer", async () => {
		traefikCalls.push("update");
		if (traefikFailure) {
			throw traefikFailure;
		}
		return { message: "Updated to v3.2", updated: true };
	});
});

afterEach(() => {
	restoreStubs();
});

const logsRoute = await import(
	"../../../src/routes/(protected)/system-logs/containers/[containerId]/logs/+server"
);
const pageRoute = await import(
	"../../../src/routes/(protected)/system-logs/+page.server"
);

const { AppLogDTO } = await import("../../../src/lib/dto/app-log-dto");
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");

type LogsEvent = Parameters<typeof logsRoute.GET>[0];

function locals(isAdmin: boolean) {
	return { isAdmin, user: { id: "u1" } };
}

describe("system logs access", () => {
	test("a developer can't stream a stack container's logs", async () => {
		streamed = false;
		const res = await logsRoute.GET({
			locals: locals(false),
			params: { containerId: "traefik" },
		} as unknown as LogsEvent);
		expect(res.status).toBe(403);
		expect(streamed).toBe(false);
	});

	test("an admin can stream a stack container's logs", async () => {
		const res = await logsRoute.GET({
			locals: locals(true),
			params: { containerId: "traefik" },
		} as unknown as LogsEvent);
		expect(res.status).toBe(200);
		expect(streamed).toBe(true);
	});

	test("a container outside the stack is a 404", async () => {
		streamed = false;
		const res = await logsRoute.GET({
			locals: locals(true),
			params: { containerId: "someone-elses" },
		} as unknown as LogsEvent);
		expect(res.status).toBe(404);
		expect(streamed).toBe(false);
	});

	test("signed out gets a 401", async () => {
		const res = await logsRoute.GET({
			locals: { isAdmin: false, user: null },
			params: { containerId: "traefik" },
		} as unknown as LogsEvent);
		expect(res.status).toBe(401);
	});

	test("the page load sends a developer home", async () => {
		await expect(
			pageRoute.load({ locals: locals(false) }),
		).rejects.toMatchObject({ location: "/", status: 302 });
	});

	test("the page load lists app errors with their service name for an admin", async () => {
		stub(AppLogDTO, "listRecent", async () => [
			{
				toJSON: () => ({
					createdAt: new Date(0),
					id: "log-1",
					level: "error",
					message: "boom",
					metadata: null,
					scope: "Deploy",
					serviceId: "svc-1",
				}),
			},
		]);
		stub(ServiceDTO, "list", async () => [{ id: "svc-1", name: "Dashy" }]);
		const result = await pageRoute.load({ locals: locals(true) });
		expect(result.appLogs).toMatchObject([
			{ id: "log-1", message: "boom", serviceName: "Dashy" },
		]);
	});

	test("clearing the app log is admin only", async () => {
		const cleared: unknown[] = [];
		stub(AppLogDTO, "clear", async (ids?: string[]) => {
			cleared.push(ids);
		});
		const spy = spyOn(console, "log").mockImplementation(() => undefined);
		await expect(
			pageRoute.actions.clearAppLogs({ locals: locals(false) }),
		).rejects.toMatchObject({ location: "/", status: 302 });
		expect(cleared).toEqual([]);
		expect(
			await pageRoute.actions.clearAppLogs({ locals: locals(true) }),
		).toEqual({ action: "clearAppLogs", success: true });
		expect(cleared).toEqual([undefined]);
		spy.mockRestore();
	});
});

describe("Traefik actions", () => {
	let spies: { mockRestore: () => void }[] = [];

	beforeEach(() => {
		traefikFailure = null;
		traefikCalls = [];
		spies = [
			spyOn(console, "log").mockImplementation(() => undefined),
			spyOn(console, "error").mockImplementation(() => undefined),
			spyOn(AppLogDTO, "create").mockResolvedValue(undefined as never),
		];
	});

	afterEach(() => {
		for (const spy of spies) {
			spy.mockRestore();
		}
	});

	const run = (
		name: keyof typeof pageRoute.actions,
		eventLocals: ReturnType<typeof locals> | { isAdmin: boolean; user: null },
	): Promise<unknown> =>
		pageRoute.actions[name]({
			locals: eventLocals,
		});

	test("signed out is sent to sign in, a developer home, and nothing runs", async () => {
		for (const name of ["restartTraefik", "updateTraefik"] as const) {
			await expect(
				run(name, { isAdmin: false, user: null }),
			).rejects.toMatchObject({ location: "/auth/sign-in", status: 302 });
			await expect(run(name, locals(false))).rejects.toMatchObject({
				location: "/",
				status: 302,
			});
		}
		expect(traefikCalls).toEqual([]);
	});

	test("an admin restarts and updates Traefik", async () => {
		expect(await run("restartTraefik", locals(true))).toEqual({
			action: "restartTraefik",
			success: true,
		});
		expect(await run("updateTraefik", locals(true))).toEqual({
			action: "updateTraefik",
			message: "Updated to v3.2",
			success: true,
			updated: true,
		});
		expect(traefikCalls).toEqual(["restart", "update"]);
	});

	test("a Docker failure is a 500 with its message", async () => {
		traefikFailure = new Error("container not found");
		for (const name of ["restartTraefik", "updateTraefik"] as const) {
			expect(await run(name, locals(true))).toMatchObject({
				data: { action: name, error: "container not found" },
				status: 500,
			});
		}
	});

	test("a non-Error failure gets a generic message", async () => {
		traefikFailure = "weird";
		expect(await run("restartTraefik", locals(true))).toMatchObject({
			data: { error: "Failed to restart Traefik." },
		});
		expect(await run("updateTraefik", locals(true))).toMatchObject({
			data: { error: "Failed to update Traefik." },
		});
	});
});
