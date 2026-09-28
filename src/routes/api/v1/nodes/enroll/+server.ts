import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
	EnrollError,
	NodeEnrollmentService,
} from "$lib/services/node-enrollment.service";

const body = z.object({
	agentToken: z.string().trim().min(1).optional(),
	agentUrl: z.string().trim().min(1).optional(),
	hostname: z.string().trim().min(1).max(253),
	plan: z.boolean().optional(),
	token: z.string().trim().min(1),
});

export const POST = async ({ request }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json(
			{ error: "Send a JSON body with token and hostname." },
			{ status: 400 },
		);
	}
	try {
		return json(
			parsed.data.plan
				? await NodeEnrollmentService.plan(parsed.data.token)
				: await NodeEnrollmentService.enroll(parsed.data),
		);
	} catch (error) {
		if (error instanceof EnrollError) {
			return json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
};
