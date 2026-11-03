import { getRequestEvent } from "$app/server";

/** Who is making the current request: its signed-in user (an API key's account included), null outside a request or when nobody is signed in. */
export function requestActor(): { id: string; name: string } | null {
	try {
		const { user } = getRequestEvent().locals;
		return user ? { id: user.id, name: user.name || user.email } : null;
	} catch {
		return null;
	}
}
