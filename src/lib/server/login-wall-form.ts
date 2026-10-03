import { oauthMethod, signInMethodAvailable } from "#lib/auth-providers.js";
import { config } from "#lib/config.js";
import { emailSignInAvailability } from "#lib/services/email-sign-in.js";
import { UserService } from "#lib/services/user.service.js";

const EMAIL_PATTERN_RE = /^(\*|[^\s@]+)@[^\s@]+\.[^\s@]+$/;

export interface LoginWallPolicy {
	authAllowedEmails: string[];
	authAllowedGroups: string[];
	authAllowedUserIds: string[];
	authProviders: string[];
	authRequired: boolean;
}

export interface LoginWallAvailability {
	email: Awaited<ReturnType<typeof emailSignInAvailability>>;
	oauthProviders: Set<string>;
}

/** Splits a textarea of comma- or newline-separated entries into trimmed, de-duplicated values. */
export function splitList(raw: string | null): string[] {
	return [
		...new Set(
			(raw ?? "")
				.split(/[\n,]/)
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	];
}

/**
 * Reads a login-wall form (the checkbox, sign-in methods, allowed users,
 * emails and groups) into a policy, or the reason it can't be saved: a
 * method that isn't enabled on this instance, a wall with no method, a wall
 * without a dashboard URL to redirect to, or a malformed email pattern.
 */
export function parseLoginWallForm(
	formData: FormData,
	available: LoginWallAvailability,
	dashboardOrigin: string | null | undefined,
): { error: string } | { policy: LoginWallPolicy } {
	const authRequired = formData.get("authRequired") === "on";
	const methods = [...new Set(formData.getAll("authProvider").map(String))];
	const policy: LoginWallPolicy = {
		authAllowedEmails: splitList(
			formData.get("authAllowedEmails") as string | null,
		),
		authAllowedGroups: splitList(
			formData.get("authAllowedGroups") as string | null,
		),
		authAllowedUserIds: [
			...new Set(formData.getAll("authAllowedUserId").map(String)),
		],
		authProviders: methods,
		authRequired,
	};
	const unavailable = methods.find(
		(method) => !signInMethodAvailable(method, available),
	);
	if (unavailable) {
		return {
			error: `"${unavailable}" isn't an enabled sign-in method on this instance.`,
		};
	}
	if (authRequired && methods.length === 0) {
		return {
			error:
				"Pick at least one sign-in method, otherwise nobody (including you) can get in.",
		};
	}
	if (authRequired && !dashboardOrigin) {
		return {
			error:
				"Set the Dashboard URL under Settings → General first : the login wall redirects visitors to this instance's own sign-in page, so Homerun has to know its own public URL.",
		};
	}
	const badEmail = policy.authAllowedEmails.find(
		(entry) => !EMAIL_PATTERN_RE.test(entry),
	);
	if (badEmail) {
		return {
			error: `"${badEmail}" isn't an email address or a *@domain pattern.`,
		};
	}
	return { policy };
}

/** Which sign-in methods a login wall may use on this instance right now. */
export async function loginWallAvailability(): Promise<LoginWallAvailability> {
	return {
		email: await emailSignInAvailability(),
		oauthProviders: new Set(
			config.auth.oauthProviders.filter((p) => p.enabled).map((p) => p.name),
		),
	};
}

/** Everything the login-wall section renders besides the policy itself: the dashboard URL, the available methods and the accounts to pick from. */
export async function loginWallOptions() {
	const [users, emailSignIn] = await Promise.all([
		UserService.listUsers(),
		emailSignInAvailability(),
	]);
	return {
		dashboardOrigin: config.auth.origin ?? null,
		emailSignIn,
		oauthProviders: config.auth.oauthProviders
			.filter((p) => p.enabled)
			.map((p) => ({
				label: p.label || p.name,
				method: oauthMethod(p.name),
				name: p.name,
			})),
		users: users.map((u) => ({
			email: u.email,
			id: u.id,
			name: u.name,
			role: u.role,
		})),
	};
}
