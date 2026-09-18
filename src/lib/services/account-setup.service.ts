import {
	createHash,
	randomBytes,
	randomInt,
	timingSafeEqual,
} from "node:crypto";
import { oauthMethod } from "$lib/auth-providers";
import { config, isSmtpEnabled } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { auth } from "./auth.ts";
import { EmailService } from "./email.service.ts";

const logger = new Logger("AccountSetup");

const PENDING_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 12;

export interface SignInProvider {
	label: string;
	name: string;
}

export type SignInLookup =
	| { providers: SignInProvider[]; step: "password" }
	| { autoRedirect: string | null; providers: SignInProvider[]; step: "sso" }
	| { emailed: boolean; step: "setup" };

interface StoredCode {
	attempts: number;
	hash: string;
}

const pendingKey = (userId: string) => `account-setup:${userId}`;
const codeKey = (userId: string) => `account-setup-code:${userId}`;
const hashCode = (code: string) =>
	createHash("sha256").update(code).digest("hex");

function enabledProviders(): SignInProvider[] {
	return config.auth.oauthProviders
		.filter((provider) => provider.enabled)
		.map((provider) => ({
			label: provider.label || provider.name,
			name: provider.name,
		}));
}

/**
 * The email-first sign-in flow's server side: what to ask a given email for
 * next, and the first-password setup for accounts an admin created without a
 * password. A pending account is marked in better-auth's own `verification`
 * table, so there's no schema of its own.
 */
class AccountSetupServiceClass {
	/**
	 * Creates an account with no usable password (a random one nobody knows)
	 * and marks it pending, so its owner sets their own password on first
	 * sign-in.
	 *
	 * @throws When better-auth refuses the account, e.g. the email is taken.
	 */
	async createPendingUser(input: {
		email: string;
		headers: Headers;
		name: string;
		role: "admin" | "user";
	}): Promise<string> {
		const { user } = await auth.api.createUser({
			body: {
				data: { emailVerified: false },
				email: input.email,
				name: input.name,
				password: randomBytes(32).toString("hex"),
				role: input.role,
			},
			headers: input.headers,
		});
		const ctx = await auth.$context;
		await ctx.internalAdapter.createVerificationValue({
			expiresAt: new Date(Date.now() + PENDING_TTL_MS),
			identifier: pendingKey(user.id),
			value: "pending",
		});
		return user.id;
	}

	/**
	 * What the sign-in page should ask for after `email`: a password, a
	 * redirect to (or a button for) the account's single sign-on provider, or
	 * the first-password setup, which emails a code first when SMTP is on.
	 * An unknown email gets the password step, so the form doesn't reveal
	 * which emails have an account.
	 */
	async lookup(email: string): Promise<SignInLookup> {
		const providers = enabledProviders();
		const ctx = await auth.$context;
		const found = await ctx.internalAdapter.findUserByEmail(email, {
			includeAccounts: true,
		});
		if (!found) {
			return { providers, step: "password" };
		}
		if (
			await ctx.internalAdapter.findVerificationValue(pendingKey(found.user.id))
		) {
			const emailed = isSmtpEnabled();
			if (emailed) {
				await this.#sendCode(found.user.id, found.user.email);
			}
			return { emailed, step: "setup" };
		}

		const linked = new Set(found.accounts.map((account) => account.providerId));
		const sso = providers.filter((provider) => linked.has(provider.name));
		const preferred = (await InstanceSettingsDTO.get()).preferredSignInMethods;
		const preferredSso =
			sso.find((provider) => preferred.includes(oauthMethod(provider.name))) ??
			null;
		if (sso.length > 0 && (!linked.has("credential") || preferredSso)) {
			return {
				autoRedirect:
					preferredSso?.name ?? (sso.length === 1 ? sso[0].name : null),
				providers: sso,
				step: "sso",
			};
		}
		return { providers, step: "password" };
	}

	/**
	 * Emails a fresh setup code to a pending account, replacing any earlier
	 * one. Does nothing for an account that isn't pending, or without SMTP.
	 */
	async resendCode(email: string): Promise<void> {
		const pending = await this.#pendingUser(email);
		if (pending && isSmtpEnabled()) {
			await this.#sendCode(pending.id, pending.email);
		}
	}

	/**
	 * Sets a pending account's first password and clears its pending mark.
	 * With SMTP on, `code` must be the one just emailed (five tries per code),
	 * which also verifies the address.
	 *
	 * @throws When the account isn't pending, the password is too short, or
	 *   the code is wrong, expired or used up.
	 */
	async complete(
		email: string,
		code: string | null,
		password: string,
	): Promise<void> {
		if (password.length < MIN_PASSWORD_LENGTH) {
			throw new Error(
				`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
			);
		}
		const pending = await this.#pendingUser(email);
		if (!pending) {
			throw new Error("This account is already set up. Sign in instead.");
		}
		const ctx = await auth.$context;
		const verified = isSmtpEnabled();
		if (verified) {
			await this.#checkCode(pending.id, code ?? "");
		}
		await ctx.internalAdapter.updatePassword(
			pending.id,
			await ctx.password.hash(password),
		);
		if (verified) {
			await ctx.internalAdapter.updateUser(pending.id, { emailVerified: true });
		}
		await ctx.internalAdapter.deleteVerificationByIdentifier(
			pendingKey(pending.id),
		);
		await ctx.internalAdapter.deleteVerificationByIdentifier(
			codeKey(pending.id),
		);
		logger.info(`Account set up: user=${pending.id} verified=${verified}`);
	}

	/** The account behind `email` when it's still waiting for its first password. */
	async #pendingUser(
		email: string,
	): Promise<{ email: string; id: string } | null> {
		const ctx = await auth.$context;
		const found = await ctx.internalAdapter.findUserByEmail(email);
		if (!found) {
			return null;
		}
		const pending = await ctx.internalAdapter.findVerificationValue(
			pendingKey(found.user.id),
		);
		return pending ? { email: found.user.email, id: found.user.id } : null;
	}

	/** Stores a new 6-digit code (hashed) and emails it. */
	async #sendCode(userId: string, email: string): Promise<void> {
		const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
		const ctx = await auth.$context;
		await ctx.internalAdapter.deleteVerificationByIdentifier(codeKey(userId));
		const stored: StoredCode = { attempts: 0, hash: hashCode(code) };
		await ctx.internalAdapter.createVerificationValue({
			expiresAt: new Date(Date.now() + CODE_TTL_MS),
			identifier: codeKey(userId),
			value: JSON.stringify(stored),
		});
		await new EmailService({
			content: `Your Homerun verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't try to sign in, ignore this email.`,
			subject: `${code} is your Homerun verification code`,
			to: email,
		}).send();
	}

	/**
	 * Checks `code` against the stored one, counting the attempt.
	 *
	 * @throws When there's no live code, it doesn't match, or it's used up.
	 */
	async #checkCode(userId: string, code: string): Promise<void> {
		const ctx = await auth.$context;
		const row = await ctx.internalAdapter.findVerificationValue(
			codeKey(userId),
		);
		if (!row || row.expiresAt < new Date()) {
			throw new Error("That code expired. Send a new one.");
		}
		const stored = JSON.parse(row.value) as StoredCode;
		const expected = Buffer.from(stored.hash, "hex");
		const given = Buffer.from(hashCode(code.trim()), "hex");
		if (timingSafeEqual(expected, given)) {
			return;
		}
		const attempts = stored.attempts + 1;
		await ctx.internalAdapter.deleteVerificationByIdentifier(codeKey(userId));
		if (attempts >= MAX_CODE_ATTEMPTS) {
			throw new Error("Too many wrong codes. Send a new one.");
		}
		await ctx.internalAdapter.createVerificationValue({
			expiresAt: row.expiresAt,
			identifier: codeKey(userId),
			value: JSON.stringify({ ...stored, attempts }),
		});
		throw new Error("That code didn't match.");
	}
}

export const AccountSetupService = new AccountSetupServiceClass();
