import type { z } from "zod";

/** A JSON `{ error }` response with `status`. */
export function apiError(message: string, status = 400): Response {
	return Response.json({ error: message }, { status });
}

export interface ApiCaller {
	isAdmin: boolean;
	userId: string;
}

/**
 * Who's calling a REST route, or the response refusing them: 401 without a
 * signed-in user or API key, 403 when the route is admin-only and the
 * caller isn't one.
 */
export function apiCaller(
	locals: { isAdmin?: boolean; user?: { id: string } | null },
	options: { adminOnly?: boolean } = {},
): ApiCaller | { refused: Response } {
	if (!locals.user) {
		return { refused: apiError("Unauthorized", 401) };
	}
	if (options.adminOnly && !locals.isAdmin) {
		return { refused: apiError("Admins only.", 403) };
	}
	return { isAdmin: Boolean(locals.isAdmin), userId: locals.user.id };
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
