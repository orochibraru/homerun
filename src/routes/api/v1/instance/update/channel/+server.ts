import { json } from "@sveltejs/kit";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { updateChannelApiBody } from "$lib/server/validation/api";

const logger = new Logger("API");

export const PATCH = async ({ locals, request }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return json({ error: "Forbidden" }, { status: 403 });
	}
	const result = updateChannelApiBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!result.success) {
		return json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	const settings = await InstanceSettingsDTO.get();
	await settings.updateUpdateChannel(result.data.channel);
	logger.info(
		`Update channel set via API: channel=${result.data.channel} user=${locals.user.id}`,
	);
	return json({ channel: settings.updateChannel });
};
