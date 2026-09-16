import { error } from "@sveltejs/kit";
import { z } from "zod";
import { query } from "$app/server";
import { Logger } from "$lib/logger";
import { requireUser } from "$lib/server/remote-auth";
import { StatusCheckService } from "$lib/services/status-check.service";

const logger = new Logger("StatusChecks");

export const listStatusCheckNames = query(
	z.object({ gitRef: z.string(), gitUrl: z.string().min(1) }),
	async ({ gitRef, gitUrl }): Promise<string[]> => {
		const user = requireUser();
		try {
			return await StatusCheckService.checkNames(
				gitUrl,
				gitRef || "main",
				user.id,
			);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			logger.warn(
				`Status check listing failed: ${gitUrl}#${gitRef} : ${reason}`,
			);
			error(502, reason);
		}
	},
);
