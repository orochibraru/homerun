import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { cancelBackupRun, enqueueVolumeBackup, enqueueVolumeRestore } =
	await import("../../../src/lib/services/backup-queue");
const { QueueService } = await import(
	"../../../src/lib/services/queue.service"
);
const { JobDTO } = await import("../../../src/lib/dto/job-dto");

const restorers: { mockRestore: () => void }[] = [];

afterEach(() => {
	for (const spy of restorers.splice(0)) {
		spy.mockRestore();
	}
});

function run(row: { jobId: string | null; success: boolean | null }) {
	const finish = mock(async () => {});
	return {
		finish,
		run: {
			finish,
			toJSON: () => ({ id: "run-1", ...row }),
		} as unknown as Parameters<typeof cancelBackupRun>[0],
	};
}

describe("cancelBackupRun", () => {
	test("cancels a running run's job and closes the run with who cancelled it", async () => {
		const cancel = spyOn(JobDTO, "cancel").mockResolvedValue([
			{ id: "job-1", payload: {}, type: "backup" },
		]);
		restorers.push(cancel);
		const { finish, run: target } = run({ jobId: "job-1", success: null });

		expect(await cancelBackupRun(target, "Ada")).toBe(true);
		expect(cancel).toHaveBeenCalledWith("job-1", "Cancelled by Ada.");
		expect(finish).toHaveBeenCalledWith({
			error: "Cancelled by Ada.",
			success: false,
		});
	});

	test("closes a run whose job is gone without touching the queue", async () => {
		const cancel = spyOn(JobDTO, "cancel").mockResolvedValue([]);
		restorers.push(cancel);
		const { finish, run: target } = run({ jobId: null, success: null });

		expect(await cancelBackupRun(target, "Ada")).toBe(true);
		expect(cancel).not.toHaveBeenCalled();
		expect(finish).toHaveBeenCalledTimes(1);
	});

	test("leaves a finished run alone", async () => {
		const cancel = spyOn(JobDTO, "cancel").mockResolvedValue([
			{ id: "job-1", payload: {}, type: "backup" },
		]);
		restorers.push(cancel);
		const { finish, run: target } = run({ jobId: "job-1", success: true });

		expect(await cancelBackupRun(target, "Ada")).toBe(false);
		expect(cancel).not.toHaveBeenCalled();
		expect(finish).not.toHaveBeenCalled();
	});
});

describe("enqueueVolumeBackup / enqueueVolumeRestore", () => {
	const volume = {
		id: "vol-1",
		name: "db-data",
		userId: "u1",
	} as unknown as Parameters<typeof enqueueVolumeBackup>[0];

	test("backups and restores share the volume's lock, each deduped on its own", async () => {
		const enqueue = spyOn(QueueService, "enqueue").mockResolvedValue(
			{} as never,
		);
		restorers.push(enqueue);
		await enqueueVolumeBackup(volume, true);
		await enqueueVolumeRestore(volume, "db-data-1.tar.gz", {
			stopServices: true,
			wipe: false,
		});
		expect(
			enqueue.mock.calls.map(([input]) => [
				input.type,
				input.lockKey,
				input.dedupeKey,
			]),
		).toEqual([
			["backup", "volume:vol-1", "backup:vol-1"],
			["backup_restore", "volume:vol-1", "restore:vol-1"],
		]);
		expect(enqueue.mock.calls[0]?.[0].payload).toMatchObject({
			scheduled: true,
			volumeId: "vol-1",
		});
	});
});
