import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { Logger } from "#lib/logger.js";
import { updateChannelApiBody } from "#lib/server/validation/api.js";

const logger = new Logger("API");

export const PATCH = async ({ locals, request }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const result = updateChannelApiBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!result.success) {
		return Response.json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	const settings = await InstanceSettingsDTO.get();
	await settings.updateUpdateChannel(result.data.channel);
	logger.info(
		`Update channel set via API: channel=${result.data.channel} user=${locals.user.id}`,
	);
	return Response.json({ channel: settings.updateChannel });
};
