import { CliAuthService } from "#lib/services/cli-auth.service.js";

/** Polled by the CLI, also unauthenticated (the device code itself is the credential being exchanged), same as device/+server.ts. */
export const POST = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const deviceCode =
		body && typeof body === "object" && "deviceCode" in body
			? String((body as { deviceCode: unknown }).deviceCode)
			: null;

	if (!deviceCode) {
		return Response.json({ error: "Missing deviceCode" }, { status: 400 });
	}

	const result = CliAuthService.poll(deviceCode);
	if (result.status === "not_found") {
		return Response.json(
			{ error: "Unknown or expired device code" },
			{ status: 404 },
		);
	}

	return Response.json(result);
};
