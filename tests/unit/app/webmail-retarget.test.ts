import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { DeploymentService } =
	await import("../../../src/lib/services/deploy.service");
const { WEBMAIL_IMAGE, WebmailService } =
	await import("../../../src/lib/services/mail/webmail");

type Service = Awaited<ReturnType<typeof ServiceDTO.list>>[number];

const restorers: { mockRestore: () => void }[] = [];

function roundcube(envVars: Record<string, string>) {
	const state = { envVars: { ...envVars } };
	const svc = {
		get envVars() {
			return state.envVars;
		},
		id: "svc-1",
		toJSON: () => ({ image: WEBMAIL_IMAGE }),
		update: mock((input: { envVars: Record<string, string> }) => {
			state.envVars = input.envVars;
			return Promise.resolve();
		}),
	};
	return { state, svc: svc as unknown as Service };
}

afterEach(() => {
	for (const restorer of restorers.splice(0)) {
		restorer.mockRestore();
	}
});

describe("WebmailService.retarget", () => {
	test("moves hosts still on the old hostname and leaves hand-set ones", async () => {
		const { state, svc } = roundcube({
			ROUNDCUBEMAIL_DEFAULT_HOST: "ssl://mail.old.test",
			ROUNDCUBEMAIL_SMTP_SERVER: "ssl://smtp.elsewhere.test",
		});
		restorers.push(
			spyOn(ServiceDTO, "list").mockResolvedValue([svc]),
			spyOn(DeploymentService, "enqueueStackDeploy").mockResolvedValue(
				undefined as never,
			),
		);
		expect(
			await WebmailService.retarget("mail.old.test", "mail.new.test", "u"),
		).toBe(1);
		expect(state.envVars).toEqual({
			ROUNDCUBEMAIL_DEFAULT_HOST: "ssl://mail.new.test",
			ROUNDCUBEMAIL_SMTP_SERVER: "ssl://smtp.elsewhere.test",
		});
	});

	test("restores a service whose redeploy can't be queued, so a retry moves it", async () => {
		const original = {
			ROUNDCUBEMAIL_DEFAULT_HOST: "ssl://mail.old.test",
			ROUNDCUBEMAIL_SMTP_SERVER: "ssl://mail.old.test",
		};
		const { state, svc } = roundcube(original);
		const enqueue = spyOn(DeploymentService, "enqueueStackDeploy");
		enqueue.mockRejectedValueOnce(new Error("queue down"));
		enqueue.mockResolvedValue(undefined as never);
		restorers.push(spyOn(ServiceDTO, "list").mockResolvedValue([svc]), enqueue);
		await expect(
			WebmailService.retarget("mail.old.test", "mail.new.test", "u"),
		).rejects.toThrow("queue down");
		expect(state.envVars).toEqual(original);
		expect(
			await WebmailService.retarget("mail.old.test", "mail.new.test", "u"),
		).toBe(1);
		expect(state.envVars.ROUNDCUBEMAIL_SMTP_SERVER).toBe("ssl://mail.new.test");
	});
});
