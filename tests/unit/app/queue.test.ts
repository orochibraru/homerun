import { beforeEach, describe, expect, mock, test } from "bun:test";

interface FakeJob {
	attempts: number;
	id: string;
	markFailed: ReturnType<typeof mock>;
	markSucceeded: ReturnType<typeof mock>;
	maxAttempts: number;
	scheduleRetry: ReturnType<typeof mock>;
	title: string;
	type: string;
}

function fakeJob(overrides: Partial<FakeJob> = {}): FakeJob {
	return {
		attempts: 1,
		id: "job-1",
		markFailed: mock(async () => undefined),
		markSucceeded: mock(async () => undefined),
		maxAttempts: 1,
		scheduleRetry: mock(async () => undefined),
		title: "Deploy web",
		type: "deploy",
		...overrides,
	};
}

mock.module("$app/environment", () => ({ building: false, dev: false }));

const cancelDependents = mock(
	async (_id: string, _reason: string) => undefined,
);
const findQueued = mock(async (_type: string, _key: string) => null as unknown);
const create = mock(async (_input: unknown) => null as unknown);
const get = mock(async (_id: string) => null as unknown);
const requeueOrphaned = mock(async () => 0);
const claimNext = mock(async () => null as unknown);

mock.module("../../../src/lib/dto/job-dto", () => ({
	JobDTO: {
		cancelDependents,
		claimNext,
		create,
		findQueued,
		get,
		requeueOrphaned,
	},
}));

const handler = mock(async (_entry: unknown) => ({ ok: true }) as unknown);
mock.module("../../../src/lib/services/queue/handlers", () => ({
	jobHandlers: { backup: handler, deploy: handler, docker_cleanup: handler },
}));

const { QueueService } = await import(
	"../../../src/lib/services/queue.service"
);
const { JobWorker } = await import("../../../src/lib/services/queue/worker");

const baseInput = {
	payload: { serviceId: "svc-1" },
	title: "Deploy web",
	type: "deploy" as const,
	userId: "user-1",
};

beforeEach(() => {
	for (const m of [
		cancelDependents,
		findQueued,
		create,
		get,
		requeueOrphaned,
		claimNext,
		handler,
	]) {
		m.mockClear();
	}
});

describe("QueueService.enqueue", () => {
	test("coalesces into an already-queued job with the same dedupe key", async () => {
		const existing = fakeJob({ id: "already-queued" });
		findQueued.mockResolvedValueOnce(existing);

		const result = await QueueService.enqueue({
			...baseInput,
			dedupeKey: "deploy:svc-1",
		});

		expect(result).toBe(existing);
		expect(create).not.toHaveBeenCalled();
	});

	test("creates a new job when nothing is queued for that key", async () => {
		const created = fakeJob({ id: "fresh" });
		findQueued.mockResolvedValueOnce(null);
		create.mockResolvedValueOnce(created);

		const result = await QueueService.enqueue({
			...baseInput,
			dedupeKey: "deploy:svc-1",
		});

		expect(result).toBe(created);
		expect(create).toHaveBeenCalledTimes(1);
	});

	test("re-reads the winner when the unique index rejects a racing insert", async () => {
		const winner = fakeJob({ id: "winner" });
		findQueued.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
		create.mockResolvedValueOnce(null);

		const result = await QueueService.enqueue({
			...baseInput,
			dedupeKey: "deploy:svc-1",
		});

		expect(result).toBe(winner);
		expect(findQueued).toHaveBeenCalledTimes(2);
	});

	test("never coalesces a job that has no dedupe key", async () => {
		const created = fakeJob();
		create.mockResolvedValueOnce(created);

		await QueueService.enqueue(baseInput);

		expect(findQueued).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledTimes(1);
	});
});

describe("QueueService.wait", () => {
	test("returns as soon as the job succeeded", async () => {
		get.mockResolvedValueOnce({ ...fakeJob(), status: "succeeded" });
		const finished = await QueueService.wait("job-1");
		expect(finished.status).toBe("succeeded");
	});

	test("returns a failed job rather than hanging or throwing", async () => {
		get.mockResolvedValueOnce({
			...fakeJob(),
			error: "boom",
			status: "failed",
		});
		const finished = await QueueService.wait("job-1");
		expect(finished.status).toBe("failed");
		expect(finished.error).toBe("boom");
	});

	test("returns a cancelled job too", async () => {
		get.mockResolvedValueOnce({ ...fakeJob(), status: "cancelled" });
		const finished = await QueueService.wait("job-1");
		expect(finished.status).toBe("cancelled");
	});
});

describe("JobWorker.runJob", () => {
	test("records the handler's own result on success", async () => {
		const entry = fakeJob();
		handler.mockResolvedValueOnce({ containerId: "abc" });

		await JobWorker.runJob(entry as never);

		expect(entry.markSucceeded).toHaveBeenCalledWith({ containerId: "abc" });
		expect(entry.markFailed).not.toHaveBeenCalled();
	});

	test("retries with backoff while attempts are left, without failing the job", async () => {
		const entry = fakeJob({ attempts: 1, maxAttempts: 3 });
		handler.mockRejectedValueOnce(new Error("s3 timed out"));

		const before = Date.now();
		await JobWorker.runJob(entry as never);

		expect(entry.markFailed).not.toHaveBeenCalled();
		expect(entry.scheduleRetry).toHaveBeenCalledTimes(1);
		const [message, runAt] = entry.scheduleRetry.mock.calls[0] as [Date, Date];
		expect(message).toBe("s3 timed out");
		expect((runAt as Date).getTime()).toBeGreaterThan(before);
		expect(cancelDependents).not.toHaveBeenCalled();
	});

	test("fails permanently on the last attempt and cancels everything downstream", async () => {
		const entry = fakeJob({ attempts: 2, maxAttempts: 2, id: "last" });
		handler.mockRejectedValueOnce(new Error("image not found"));

		await JobWorker.runJob(entry as never);

		expect(entry.scheduleRetry).not.toHaveBeenCalled();
		expect(entry.markFailed).toHaveBeenCalledWith("image not found");
		expect(cancelDependents).toHaveBeenCalledTimes(1);
		expect(cancelDependents.mock.calls[0]?.[0]).toBe("last");
	});
});
