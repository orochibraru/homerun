import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { closeCancelledDeploys } = await import(
	"../../../src/lib/services/queue/cancelled-deploys"
);
const { DeploymentDTO } = await import("../../../src/lib/dto/deployment-dto");
const { DockerService } = await import(
	"../../../src/lib/services/docker.service"
);

const restorers: { mockRestore: () => void }[] = [];

afterEach(() => {
	for (const spy of restorers.splice(0)) {
		spy.mockRestore();
	}
});

describe("closeCancelledDeploys", () => {
	test("fails a cancelled deploy's pending deployment and re-reads its service, skipping other jobs", async () => {
		const update = mock(async () => {});
		const get = spyOn(DeploymentDTO, "get").mockResolvedValue({
			toJSON: () => ({ status: "pending" }),
			update,
		} as never);
		const sync = spyOn(DockerService, "syncServiceStatus").mockResolvedValue(
			"running" as never,
		);
		restorers.push(get, sync);

		await closeCancelledDeploys(
			[
				{ id: "j1", payload: { volumeId: "v" }, type: "backup_restore" },
				{
					id: "j2",
					payload: { deploymentId: "d1", serviceId: "svc-1", userId: "u" },
					type: "deploy",
				},
			],
			"Cancelled because the restore failed.",
		);

		expect(get).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				errorMessage: "Cancelled because the restore failed.",
				status: "failed",
			}),
		);
		expect(sync).toHaveBeenCalledWith("svc-1");
	});

	test("leaves a deployment that already finished and never throws", async () => {
		const update = mock(async () => {});
		const get = spyOn(DeploymentDTO, "get").mockResolvedValue({
			toJSON: () => ({ status: "running" }),
			update,
		} as never);
		const sync = spyOn(DockerService, "syncServiceStatus").mockRejectedValue(
			new Error("docker down"),
		);
		restorers.push(get, sync);

		await closeCancelledDeploys(
			[
				{
					id: "j2",
					payload: { deploymentId: "d1", serviceId: "svc-1", userId: "u" },
					type: "deploy",
				},
			],
			"x",
		);
		expect(update).not.toHaveBeenCalled();
	});
});
