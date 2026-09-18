import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { JobDTO } = await import("../../../src/lib/dto/job-dto");
const { QueueService } = await import(
	"../../../src/lib/services/queue.service"
);

type Job = Awaited<ReturnType<typeof JobDTO.get>>;

const job = (status: string) => ({ id: "job-1", status }) as unknown as Job;

const input = {
	payload: {},
	title: "Deploy web",
	type: "deploy",
	userId: "u1",
} as unknown as Parameters<typeof QueueService.enqueue>[0];

let spies: { mockRestore: () => void }[] = [];

function stub<K extends "create" | "findQueued" | "get">(
	name: K,
	impl: (...args: never[]) => Promise<unknown>,
) {
	const spy = spyOn(JobDTO, name).mockImplementation(impl as never);
	spies.push(spy);
	return spy;
}

afterEach(() => {
	for (const spy of spies.reverse()) {
		spy.mockRestore();
	}
	spies = [];
});

describe("QueueService.enqueue", () => {
	test("returns the already-queued job for the same dedupe key", async () => {
		const create = stub("create", async () => job("queued"));
		stub("findQueued", async () => job("queued"));
		const queued = await QueueService.enqueue({ ...input, dedupeKey: "k" });
		expect(queued.id).toBe("job-1");
		expect(create).not.toHaveBeenCalled();
	});

	test("creates the job otherwise", async () => {
		stub("findQueued", async () => null);
		const create = stub("create", async () => job("queued"));
		expect((await QueueService.enqueue({ ...input, dedupeKey: "k" })).id).toBe(
			"job-1",
		);
		expect(create).toHaveBeenCalledTimes(1);
	});
});

describe("QueueService.enqueue race", () => {
	test("returns the job that won a racing insert", async () => {
		const found = [null, job("queued")];
		stub("findQueued", async () => found.shift() ?? null);
		stub("create", async () => null);
		expect((await QueueService.enqueue({ ...input, dedupeKey: "k" })).id).toBe(
			"job-1",
		);
	});
});

describe("QueueService.enqueue failures", () => {
	test("throws when the insert fails and there's no dedupe key to recover with", async () => {
		stub("create", async () => null);
		const findQueued = stub("findQueued", async () => null);
		await expect(QueueService.enqueue(input)).rejects.toThrow(
			"Couldn't queue the job.",
		);
		expect(findQueued).not.toHaveBeenCalled();
	});

	test("throws when the insert fails and no racing job turns up", async () => {
		stub("create", async () => null);
		const findQueued = stub("findQueued", async () => null);
		await expect(
			QueueService.enqueue({ ...input, dedupeKey: "deploy:svc" }),
		).rejects.toThrow("Couldn't queue the job.");
		expect(findQueued).toHaveBeenCalledTimes(2);
	});
});

describe("QueueService.wait polling", () => {
	test("polls until the job reaches a terminal status", async () => {
		const states = ["queued", "running", "succeeded"];
		const get = stub("get", async () => job(states.shift() ?? "succeeded"));
		const finished = await QueueService.wait("job-1");
		expect(finished.status).toBe("succeeded");
		expect(get).toHaveBeenCalledTimes(3);
	});

	test("times out on a job that never finishes", async () => {
		stub("get", async () => job("running"));
		await expect(QueueService.wait("job-1", -1)).rejects.toThrow(
			"Timed out waiting for the queued job to finish.",
		);
	});

	test("throws when the job row is gone, up front or mid-wait", async () => {
		stub("get", async () => null);
		await expect(QueueService.wait("job-1")).rejects.toThrow(
			"The queued job disappeared before it finished.",
		);
		spies.pop()?.mockRestore();

		const states: (Job | null)[] = [job("running"), null];
		stub("get", async () => states.shift() ?? null);
		await expect(QueueService.wait("job-1")).rejects.toThrow(
			"The queued job disappeared",
		);
	});
});
