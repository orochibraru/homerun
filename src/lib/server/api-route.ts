import type { z } from "zod";
import type { Permissions } from "#lib/permissions.js";

/** A JSON `{ error }` response with `status`. */
export function apiError(message: string, status = 400): Response {
	return Response.json({ error: message }, { status });
}

export interface ApiCaller {
	permissions: Permissions;
	userId: string;
}

/**
 * Who's calling a REST route, or the 401 refusing them without a signed-in
 * user or API key. Which areas the caller may read or change is already
 * enforced by the request hook from the route's area.
 */
export function apiCaller(locals: {
	permissions?: Permissions;
	user?: { id: string } | null;
}): ApiCaller | { refused: Response } {
	if (!locals.user) {
		return { refused: apiError("Unauthorized", 401) };
	}
	return { permissions: locals.permissions ?? {}, userId: locals.user.id };
}

/**
 * The request's JSON body validated by `schema`, or the 400 response
 * listing what's wrong with it.
 */
export async function readApiBody<T extends z.ZodType>(
	request: Request,
	schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
	const result = schema.safeParse(await request.json().catch(() => null));
	return result.success
		? { data: result.data }
		: {
				response: Response.json(
					{ error: "Invalid request body", issues: result.error.flatten() },
					{ status: 400 },
				),
			};
}
