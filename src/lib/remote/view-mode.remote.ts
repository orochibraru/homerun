import { command } from "$app/server";
import { z } from "zod";

import { UserPreferencesDTO } from "#lib/dto/user-preferences-dto.js";
import { requireUser } from "#lib/server/remote-auth.js";
import { VIEW_MODE_KEY, VIEW_MODES } from "#lib/view-modes.js";

export const setViewMode = command(
	z.object({
		key: z.string().max(64).regex(VIEW_MODE_KEY),
		mode: z.enum(VIEW_MODES),
	}),
	async ({ key, mode }) => {
		const user = requireUser();
		const preferences = await UserPreferencesDTO.get(user.id);
		await preferences.updateViewMode(key, mode);
	},
);
