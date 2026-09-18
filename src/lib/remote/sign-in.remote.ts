import { error } from "@sveltejs/kit";
import { z } from "zod";
import { dev } from "$app/environment";
import { command, getRequestEvent } from "$app/server";
import {
	AccountSetupService,
	type SignInLookup,
} from "$lib/services/account-setup.service";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const attempts = new Map<string, number[]>();

/** Refuses a caller past `MAX_PER_WINDOW` calls a minute, per IP and command: these run before anyone is signed in. */
function throttle(name: string): void {
	if (dev || process.env.HOMERUN_DISABLE_AUTH_RATE_LIMIT === "1") {
		return;
	}
	const key = `${name}:${getRequestEvent().getClientAddress()}`;
	const now = Date.now();
	const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
	if (recent.length >= MAX_PER_WINDOW) {
		error(429, "Too many attempts. Wait a minute and try again.");
	}
	recent.push(now);
	attempts.set(key, recent);
}

const emailField = z.string().trim().toLowerCase().email();

export const lookupSignIn = command(
	emailField,
	async (email): Promise<SignInLookup> => {
		throttle("lookup");
		return await AccountSetupService.lookup(email);
	},
);

export const resendSetupCode = command(emailField, async (email) => {
	throttle("resend");
	await AccountSetupService.resendCode(email);
});

export const completeAccountSetup = command(
	z.object({
		code: z.string().nullable(),
		email: emailField,
		password: z.string(),
	}),
	async ({ code, email, password }) => {
		throttle("complete");
		try {
			await AccountSetupService.complete(email, code, password);
		} catch (err) {
			error(400, err instanceof Error ? err.message : "Couldn't set that up.");
		}
	},
);
