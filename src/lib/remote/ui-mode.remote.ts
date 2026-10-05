import { z } from "zod";
import { UserPreferencesDTO } from "#lib/dto/user-preferences-dto.js";
import { Logger } from "#lib/logger.js";
import { requireUser } from "#lib/server/remote-auth.js";
import { UI_MODES } from "#lib/ui-mode.js";
import { command } from "$app/server";

const logger = new Logger("Appearance");

export const setUiMode = command(z.enum(UI_MODES), async (mode) => {
	const user = requireUser();
	const preferences = await UserPreferencesDTO.get(user.id);
	await preferences.updateUiMode(mode);
	logger.info(`UI mode set: mode=${mode} user=${user.id}`);
});
