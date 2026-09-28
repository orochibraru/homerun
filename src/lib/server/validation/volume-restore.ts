import { z } from "zod";
import { RESTORE_MODES } from "$lib/restore-modes";

const checkbox = z
	.string()
	.optional()
	.transform((value) => value === "on");

/** The service Storage tab's restore form: which backup into which volume, how, and the typed confirmation. */
export const restoreBackupFormSchema = z.object({
	confirm: z.string().trim(),
	key: z.string().trim().min(1, "Pick a backup."),
	mode: z.enum(RESTORE_MODES.map((mode) => mode.id)),
	stopServices: checkbox,
	volumeId: z.string().min(1),
	wipe: checkbox,
});
