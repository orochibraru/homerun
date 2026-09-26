import { fail, type RequestEvent, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { AccountSetupService } from "$lib/services/account-setup.service";

function signedInUser(event: RequestEvent): { email: string; id: string } {
	if (!event.locals.user) {
		throw redirect(303, resolve("/auth/sign-in"));
	}
	return { email: event.locals.user.email, id: event.locals.user.id };
}

function failure(err: unknown, fallback: string) {
	return fail(400, { error: err instanceof Error ? err.message : fallback });
}

/**
 * Form actions letting a signed-in account without a password add one:
 * `sendPasswordCode` emails a code, `setPassword` checks it and sets the
 * password. Shared by Profile → Security and `/my-apps`.
 */
export const setPasswordActions = {
	sendPasswordCode: async (event: RequestEvent) => {
		const user = signedInUser(event);
		try {
			await AccountSetupService.sendPasswordCode(user);
		} catch (err) {
			return failure(err, "Couldn't send a code.");
		}
		return { codeSent: true };
	},
	setPassword: async (event: RequestEvent) => {
		const user = signedInUser(event);
		const form = await event.request.formData();
		try {
			await AccountSetupService.addPassword({
				code: String(form.get("code") ?? ""),
				headers: event.request.headers,
				password: String(form.get("password") ?? ""),
				user,
			});
		} catch (err) {
			return failure(err, "Couldn't set your password.");
		}
		return { passwordSet: true };
	},
};
