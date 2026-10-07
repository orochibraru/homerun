import { z } from "zod";
import { requirePermission, requireUser } from "#lib/server/remote-auth.js";
import type { UpdatePreflight } from "#lib/services/self-update/preflight.js";
import {
	type ReleaseStatus,
	SelfUpdateService,
} from "#lib/services/self-update.service.js";
import { command, query } from "$app/server";

export const getAppVersion = query((): string => {
	requireUser();
	return SelfUpdateService.currentVersion;
});

export const getReleaseStatus = query(async (): Promise<ReleaseStatus> => {
	requirePermission("settings", "read");
	return await SelfUpdateService.releaseStatus();
});

export const checkForUpdates = command(async (): Promise<ReleaseStatus> => {
	requirePermission("settings", "read");
	const status = await SelfUpdateService.releaseStatus({ fresh: true });
	await getReleaseStatus().refresh();
	return status;
});

export const getUpdatePreflight = query(async (): Promise<UpdatePreflight> => {
	requirePermission("settings", "read");
	return await SelfUpdateService.preflight();
});

export const startSelfUpdate = command(
	z.object({ force: z.boolean().default(false) }),
	async ({ force }): Promise<{ version: string }> => {
		requirePermission("settings", "write");
		return await SelfUpdateService.start({ force });
	},
);
