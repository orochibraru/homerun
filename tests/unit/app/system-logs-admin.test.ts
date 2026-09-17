import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

mock.module("$app/paths", () => ({
	resolve: (path: string) => path,
}));

let streamed = false;

mock.module("$lib/services/docker.service", () => ({
	DockerService: {
		listInfraContainers: async () => [{ id: "traefik" }],
		streamLogs: async () => {
			streamed = true;
			return new ReadableStream();
		},
	},
}));

const logsRoute = await import(
	"../../../src/routes/(protected)/system-logs/containers/[containerId]/logs/+server"
);
const pageRoute = await import(
	"../../../src/routes/(protected)/system-logs/+page.server"
);

type LogsEvent = Parameters<typeof logsRoute.GET>[0];
type LoadEvent = Parameters<typeof pageRoute.load>[0];

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

	test("the page load sends a developer home", () => {
		let thrown: unknown;
		try {
			pageRoute.load({ locals: locals(false) } as unknown as LoadEvent);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({ location: "/", status: 302 });
		expect(() =>
			pageRoute.load({ locals: locals(true) } as unknown as LoadEvent),
		).not.toThrow();
	});
});
