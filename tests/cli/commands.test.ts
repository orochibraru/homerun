import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ClientFactory } from "../../cli/client";
import { Commands } from "../../cli/commands";
import { Output } from "../../cli/output";

type Client = ReturnType<typeof ClientFactory.makeClient>;

class FailCalled extends Error {}

function fakeClient(overrides: {
	GET?: ReturnType<typeof mock>;
	POST?: ReturnType<typeof mock>;
}): Client {
	return {
		GET: overrides.GET ?? mock(),
		POST: overrides.POST ?? mock(),
	} as unknown as Client;
}

function okResponse<T>(data: T) {
	return { data, error: undefined, response: { ok: true, status: 200 } };
}

function errResponse(status: number, statusText: string, error: unknown) {
	return {
		data: undefined,
		error,
		response: { ok: false, status, statusText },
	};
}

let printJsonSpy: ReturnType<typeof spyOn>;
let printTableSpy: ReturnType<typeof spyOn>;

afterEach(() => {
	mock.restore();
});

function spyOnOutput() {
	printJsonSpy = spyOn(Output, "printJson").mockImplementation(() => undefined);
	printTableSpy = spyOn(Output, "printTable").mockImplementation(
		() => undefined,
	);
}

describe("Commands.servicesList", () => {
	test("prints JSON when json=true", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([
				{
					currentStatus: "running",
					id: "1",
					image: "nginx",
					name: "svc",
					slug: "svc",
					tag: "latest",
				},
			]),
		);
		const client = fakeClient({ GET });

		await Commands.servicesList(client, true);

		expect(GET).toHaveBeenCalledWith("/services");
		expect(printJsonSpy).toHaveBeenCalled();
		expect(printTableSpy).not.toHaveBeenCalled();
	});

	test("prints a mapped table when json=false", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([
				{
					currentStatus: "running",
					id: "1",
					image: "nginx",
					name: "svc",
					slug: "svc",
					tag: "latest",
				},
			]),
		);
		const client = fakeClient({ GET });

		await Commands.servicesList(client, false);

		expect(printTableSpy).toHaveBeenCalledWith(
			[
				{
					id: "1",
					image: "nginx:latest",
					name: "svc",
					slug: "svc",
					status: "running",
				},
			],
			["id", "name", "slug", "status", "image"],
		);
	});

	test("calls Output.fail() with the status and body on an error response", async () => {
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const GET = mock(async () =>
			errResponse(404, "Not Found", { error: "nope" }),
		);
		const client = fakeClient({ GET });

		await expect(Commands.servicesList(client, true)).rejects.toThrow(
			FailCalled,
		);
		expect(failSpy).toHaveBeenCalledWith('404 Not Found: {"error":"nope"}');
	});
});

describe("Commands.serviceGet", () => {
	test("fetches by id and prints JSON", async () => {
		spyOnOutput();
		const GET = mock(async () => okResponse({ id: "svc-1" }));
		const client = fakeClient({ GET });

		await Commands.serviceGet(client, "svc-1");

		expect(GET).toHaveBeenCalledWith("/services/{serviceId}", {
			params: { path: { serviceId: "svc-1" } },
		});
		expect(printJsonSpy).toHaveBeenCalledWith({ id: "svc-1" });
	});
});

describe("Commands.serviceAction", () => {
	test.each(["deploy", "start", "stop", "restart"] as const)(
		"POSTs to /services/{serviceId}/%s",
		async (action) => {
			spyOnOutput();
			const POST = mock(async () => okResponse({ ok: true }));
			const client = fakeClient({ POST });

			await Commands.serviceAction(client, action, "svc-1");

			expect(POST).toHaveBeenCalledWith(`/services/{serviceId}/${action}`, {
				params: { path: { serviceId: "svc-1" } },
			});
			expect(printJsonSpy).toHaveBeenCalledWith({ ok: true });
		},
	);
});

describe("Commands.projectsList", () => {
	test("prints a mapped table when json=false", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([{ id: "p1", name: "Project One", slug: "project-one" }]),
		);
		const client = fakeClient({ GET });

		await Commands.projectsList(client, false);

		expect(printTableSpy).toHaveBeenCalledWith(
			[{ id: "p1", name: "Project One", slug: "project-one" }],
			["id", "name", "slug"],
		);
	});
});

describe("Commands.templatesList", () => {
	test("prints a mapped table combining image:tag when json=false", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([{ id: "t1", image: "redis", name: "Redis", tag: "7" }]),
		);
		const client = fakeClient({ GET });

		await Commands.templatesList(client, false);

		expect(printTableSpy).toHaveBeenCalledWith(
			[{ id: "t1", image: "redis:7", name: "Redis" }],
			["id", "name", "image"],
		);
	});
});
