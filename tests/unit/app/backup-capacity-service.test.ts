import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { BackupCapacityService } = await import(
	"../../../src/lib/services/backup-capacity.service"
);
const { S3BackupService } = await import(
	"../../../src/lib/services/s3-backup.service"
);
const { NotificationChannelService } = await import(
	"../../../src/lib/services/notification-channel.service"
);
const rclone = await import("../../../src/lib/services/backup/rclone");
const { S3DestinationDTO } = await import(
	"../../../src/lib/dto/s3-destination-dto"
);

type Destination = NonNullable<
	Awaited<ReturnType<typeof S3DestinationDTO.get>>
>;

const restorers: { mockRestore: () => void }[] = [];

afterEach(() => {
	for (const spy of restorers.splice(0)) {
		spy.mockRestore();
	}
});

function destination(alertedAt: Date | null, percent = 85) {
	const row = {
		capacityAlertPercent: percent,
		capacityAlertedAt: alertedAt,
		id: "d1",
		name: "NAS",
	};
	return {
		id: "d1",
		name: "NAS",
		recordCapacity: mock(async () => {}),
		setCapacityAlerted: mock(async (at: Date | null) => {
			row.capacityAlertedAt = at;
		}),
		toJSON: () => row,
	} as unknown as Destination & {
		recordCapacity: ReturnType<typeof mock>;
		setCapacityAlerted: ReturnType<typeof mock>;
	};
}

function measuring(used: number) {
	restorers.push(
		spyOn(S3BackupService, "targetOf").mockReturnValue({
			remote: {
				entrypoint: [],
				env: {},
				image: "rclone",
				label: "NAS",
				path: "/backups",
			},
		}),
		spyOn(rclone, "remoteAbout").mockResolvedValue({
			freeBytes: 100 - used,
			totalBytes: 100,
			usedBytes: used,
		}),
	);
	const notify = spyOn(NotificationChannelService, "notify").mockImplementation(
		() => {},
	);
	restorers.push(notify);
	return notify;
}

describe("BackupCapacityService.check", () => {
	test("records the figures and alerts once past the threshold", async () => {
		const notify = measuring(90);
		const target = destination(null);
		const result = await BackupCapacityService.check(target);
		expect(result).toEqual({
			capacity: { freeBytes: 10, totalBytes: 100, usedBytes: 90 },
		});
		expect(target.recordCapacity).toHaveBeenCalledWith(result);
		expect(target.setCapacityAlerted).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0][0]).toMatchObject({
			event: "backup.storage_low",
			title: "NAS is 90% full",
		});
	});

	test("doesn't alert twice, and clears once clearly back under", async () => {
		const notify = measuring(95);
		await BackupCapacityService.check(destination(new Date()));
		expect(notify).not.toHaveBeenCalled();
		for (const spy of restorers.splice(0)) {
			spy.mockRestore();
		}
		measuring(70);
		const recovered = destination(new Date());
		await BackupCapacityService.check(recovered);
		expect(recovered.setCapacityAlerted).toHaveBeenCalledWith(null);
	});

	test("records a failed measurement without alerting", async () => {
		const notify = measuring(0);
		restorers.push(
			spyOn(rclone, "remoteAbout").mockRejectedValue(new Error("no route")),
		);
		const target = destination(null);
		expect(await BackupCapacityService.check(target)).toEqual({
			error: "no route",
		});
		expect(target.recordCapacity).toHaveBeenCalledWith({ error: "no route" });
		expect(notify).not.toHaveBeenCalled();
	});

	test("an S3 bucket isn't measured", async () => {
		restorers.push(
			spyOn(S3BackupService, "targetOf").mockReturnValue({
				destination: {
					accessKeyId: "a",
					bucket: "b",
					endpoint: "https://s3",
					region: "r",
					secretAccessKey: "s",
				},
			}),
		);
		const target = destination(null);
		expect(await BackupCapacityService.check(target)).toMatchObject({
			error: expect.stringContaining("S3"),
		});
		expect(target.recordCapacity).not.toHaveBeenCalled();
	});
});

describe("BackupCapacityService.checkAll", () => {
	test("checks every non-S3 destination, carrying on past a failure", async () => {
		const first = destination(null);
		const second = destination(null);
		restorers.push(
			spyOn(S3DestinationDTO, "listNonS3").mockResolvedValue([first, second]),
		);
		const check = spyOn(BackupCapacityService, "check")
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce({ error: "unreachable" });
		restorers.push(check);
		await BackupCapacityService.checkAll();
		expect(check).toHaveBeenCalledTimes(2);
	});
});
