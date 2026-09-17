import { command, query } from "$app/server";
import {
	requireAdmin,
	requireUser,
	requireWriter,
} from "$lib/server/remote-auth";
import {
	type ReleaseStatus,
	SelfUpdateService,
	type UpdatePreflight,
} from "$lib/services/self-update.service";

export const getAppVersion = query((): string => {
	requireUser();
	return SelfUpdateService.currentVersion;
});

export const getReleaseStatus = query(async (): Promise<ReleaseStatus> => {
	requireAdmin();
	return await SelfUpdateService.releaseStatus();
});

export const getUpdatePreflight = query(async (): Promise<UpdatePreflight> => {
	requireAdmin();
	return await SelfUpdateService.preflight();
});

export const startSelfUpdate = command(
	async (): Promise<{ version: string }> => {
		requireAdmin();
		requireWriter();
		return await SelfUpdateService.start();
	},
);
