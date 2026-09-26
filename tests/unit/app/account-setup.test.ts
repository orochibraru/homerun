import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

interface Verification {
	expiresAt: Date;
	identifier: string;
	value: string;
}

interface FakeUser {
	accounts: { providerId: string }[];
	user: { email: string; id: string };
}

const verifications = new Map<string, Verification>();
const users = new Map<string, FakeUser>();
const passwords = new Map<string, string>();
const userUpdates: [string, Record<string, unknown>][] = [];
const createdUsers: Record<string, unknown>[] = [];

const internalAdapter = {
	createVerificationValue: async (row: Verification) => {
		verifications.set(row.identifier, row);
		return row;
	},
	deleteVerificationByIdentifier: async (identifier: string) => {
		verifications.delete(identifier);
	},
	findUserByEmail: async (email: string) => users.get(email) ?? null,
	findVerificationValue: async (identifier: string) =>
		verifications.get(identifier) ?? null,
	updatePassword: async (userId: string, hash: string) => {
		passwords.set(userId, hash);
	},
	updateUser: async (userId: string, data: Record<string, unknown>) => {
		userUpdates.push([userId, data]);
	},
};

const fakeAuth = {
	$context: Promise.resolve({
		internalAdapter,
		password: { hash: async (plain: string) => `hashed:${plain}` },
	}),
	api: {
		createUser: async ({ body }: { body: Record<string, unknown> }) => {
			createdUsers.push(body);
			const id = `user-${createdUsers.length}`;
			users.set(String(body.email), {
				accounts: [{ providerId: "credential" }],
				user: { email: String(body.email), id },
			});
			return { user: { id } };
		},
	},
};

mock.module("$lib/services/auth", () => ({
	auth: fakeAuth,
	rebuildAuth: () => undefined,
}));

const { oauthMethod } = await import("../../../src/lib/auth-providers");
const { applyInstanceSettings, config } = await import(
	"../../../src/lib/config"
);
const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);
const { EmailService } = await import(
	"../../../src/lib/services/email.service"
);
const { AccountSetupService } = await import(
	"../../../src/lib/services/account-setup.service"
);

const SMTP = {
	smtpEnabled: true,
	smtpFrom: "homerun@example.com",
	smtpHost: "smtp.example.com",
	smtpPassword: "pw",
	smtpPort: 587,
	smtpUser: "mailer",
};

let sent: { content: string; subject: string; to: string }[] = [];
let preferred: string[] = [];
let emailSignIn = { emailOtp: true, magicLink: false };
const NONE = { emailOtp: false, magicLink: false };
let spies: { mockRestore: () => void }[] = [];

function provider(name: string, enabled = true, label = "") {
	return {
		clientId: "id",
		clientSecret: "secret",
		discoveredTokenAuth: [],
		discoveryUrl: `https://${name}.example.com/.well-known/openid-configuration`,
		enabled,
		label,
		name,
		pkce: true,
		scopes: [],
		signOutOfProvider: false,
		tokenAuthMethod: "auto" as const,
	};
}

function addUser(email: string, providers: string[], pending = false) {
	const id = `id-${email}`;
	users.set(email, {
		accounts: providers.map((providerId) => ({ providerId })),
		user: { email, id },
	});
	if (pending) {
		verifications.set(`account-setup:${id}`, {
			expiresAt: new Date(Date.now() + 60_000),
			identifier: `account-setup:${id}`,
			value: "pending",
		});
	}
	return id;
}

function lastCode(): string {
	return /code is (\d{6})/.exec(sent.at(-1)?.content ?? "")?.[1] ?? "";
}

beforeEach(() => {
	verifications.clear();
	users.clear();
	passwords.clear();
	userUpdates.length = 0;
	createdUsers.length = 0;
	sent = [];
	preferred = [];
	emailSignIn = { emailOtp: true, magicLink: false };
	spies = [
		spyOn(console, "log").mockImplementation(() => undefined),
		spyOn(EmailService.prototype, "send").mockImplementation(function (
			this: InstanceType<typeof EmailService>,
		) {
			sent.push({ content: this.content, subject: this.subject, to: this.to });
			return Promise.resolve(undefined as never);
		}),
		spyOn(InstanceSettingsDTO, "get").mockImplementation(
			async () =>
				({
					emailSignIn,
					preferredSignInMethods: preferred,
				}) as unknown as Awaited<ReturnType<typeof InstanceSettingsDTO.get>>,
		),
	];
});

afterEach(() => {
	for (const spy of spies.reverse()) {
		spy.mockRestore();
	}
	applyInstanceSettings({});
});

describe("AccountSetupService.lookup", () => {
	test("an unknown email gets the password step with every enabled provider", async () => {
		config.auth.oauthProviders = [
			provider("github", true, "GitHub"),
			provider("gitlab", false),
			provider("authentik"),
		];
		expect(await AccountSetupService.lookup("nobody@example.com")).toEqual({
			email: NONE,
			providers: [
				{ label: "GitHub", name: "github" },
				{ label: "authentik", name: "authentik" },
			],
			step: "password",
		});
	});

	test("a password account gets the password step", async () => {
		addUser("pw@example.com", ["credential"]);
		expect(await AccountSetupService.lookup("pw@example.com")).toEqual({
			email: NONE,
			providers: [],
			step: "password",
		});
	});

	test("an account linked only to one provider is sent straight to it", async () => {
		config.auth.oauthProviders = [provider("github"), provider("gitlab")];
		addUser("sso@example.com", ["github"]);
		expect(await AccountSetupService.lookup("sso@example.com")).toEqual({
			autoRedirect: "github",
			email: NONE,
			providers: [{ label: "github", name: "github" }],
			step: "sso",
		});
	});

	test("several linked providers are offered without a redirect", async () => {
		config.auth.oauthProviders = [provider("github"), provider("gitlab")];
		addUser("both@example.com", ["github", "gitlab"]);
		const result = await AccountSetupService.lookup("both@example.com");
		expect(result).toMatchObject({ autoRedirect: null, step: "sso" });
	});

	test("a password account with a linked provider only redirects when that provider is preferred", async () => {
		config.auth.oauthProviders = [provider("github"), provider("gitlab")];
		addUser("mixed@example.com", ["credential", "github", "gitlab"]);
		expect((await AccountSetupService.lookup("mixed@example.com")).step).toBe(
			"password",
		);

		preferred = [oauthMethod("gitlab")];
		expect(await AccountSetupService.lookup("mixed@example.com")).toMatchObject(
			{
				autoRedirect: "gitlab",
				step: "sso",
			},
		);
	});

	test("a link to a disabled provider doesn't count", async () => {
		config.auth.oauthProviders = [provider("github", false)];
		addUser("off@example.com", ["github"]);
		expect((await AccountSetupService.lookup("off@example.com")).step).toBe(
			"password",
		);
	});
});

describe("AccountSetupService.lookup with emailed sign-in", () => {
	test("an account with no password and no provider gets the email-only step", async () => {
		applyInstanceSettings(SMTP);
		addUser("client@example.com", []);
		expect(await AccountSetupService.lookup("client@example.com")).toEqual({
			email: { emailOtp: true, magicLink: false },
			step: "email-only",
		});
	});

	test("every step says which emailed methods are on, and none without SMTP", async () => {
		addUser("client@example.com", []);
		expect((await AccountSetupService.lookup("client@example.com")).step).toBe(
			"password",
		);

		applyInstanceSettings(SMTP);
		emailSignIn = { emailOtp: false, magicLink: true };
		addUser("pw@example.com", ["credential"]);
		expect(await AccountSetupService.lookup("pw@example.com")).toEqual({
			email: { emailOtp: false, magicLink: true },
			providers: [],
			step: "password",
		});
		expect((await AccountSetupService.lookup("client@example.com")).step).toBe(
			"email-only",
		);

		emailSignIn = NONE;
		expect((await AccountSetupService.lookup("client@example.com")).step).toBe(
			"password",
		);
	});
});

describe("AccountSetupService pending accounts", () => {
	test("createPendingUser makes an account with an unknown password, marked pending", async () => {
		const headers = new Headers({ cookie: "x" });
		const id = await AccountSetupService.createPendingUser({
			email: "new@example.com",
			headers,
			name: "New",
			role: "user",
		});
		expect(createdUsers[0]).toMatchObject({
			data: { emailVerified: false },
			email: "new@example.com",
			name: "New",
			role: "user",
		});
		expect(String(createdUsers[0].password)).toMatch(/^[0-9a-f]{64}$/);
		expect(verifications.get(`account-setup:${id}`)?.value).toBe("pending");
		expect(await AccountSetupService.lookup("new@example.com")).toEqual({
			email: NONE,
			emailed: false,
			step: "setup",
		});
		expect(sent).toEqual([]);
	});

	test("with SMTP on, the setup step emails a code and stores only its hash", async () => {
		applyInstanceSettings(SMTP);
		const id = addUser("p@example.com", ["credential"], true);
		expect(await AccountSetupService.lookup("p@example.com")).toEqual({
			email: { emailOtp: true, magicLink: false },
			emailed: true,
			step: "setup",
		});
		expect(sent[0].to).toBe("p@example.com");
		const code = lastCode();
		expect(code).toMatch(/^\d{6}$/);
		expect(sent[0].subject).toBe(`${code} is your Homerun verification code`);
		const stored = verifications.get(`account-setup-code:${id}`);
		expect(stored?.value).not.toContain(code);
		expect(JSON.parse(stored?.value ?? "{}").attempts).toBe(0);
	});

	test("resendCode replaces the code, only for a pending account with SMTP", async () => {
		addUser("p@example.com", ["credential"], true);
		addUser("done@example.com", ["credential"]);
		await AccountSetupService.resendCode("p@example.com");
		expect(sent).toEqual([]);

		applyInstanceSettings(SMTP);
		await AccountSetupService.resendCode("done@example.com");
		await AccountSetupService.resendCode("ghost@example.com");
		expect(sent).toEqual([]);

		await AccountSetupService.resendCode("p@example.com");
		await AccountSetupService.resendCode("p@example.com");
		expect(sent).toHaveLength(2);
		expect(
			[...verifications.keys()].filter((k) =>
				k.startsWith("account-setup-code:"),
			),
		).toHaveLength(1);
	});
});

describe("AccountSetupService.complete without SMTP", () => {
	test("rejects a short password before touching anything", async () => {
		addUser("p@example.com", ["credential"], true);
		await expect(
			AccountSetupService.complete("p@example.com", null, "short"),
		).rejects.toThrow("Use at least 12 characters for your password.");
		expect(passwords.size).toBe(0);
	});

	test("refuses an account that isn't pending", async () => {
		addUser("done@example.com", ["credential"]);
		await expect(
			AccountSetupService.complete("done@example.com", null, "long-enough-pw"),
		).rejects.toThrow("This account is already set up. Sign in instead.");
		await expect(
			AccountSetupService.complete("ghost@example.com", null, "long-enough-pw"),
		).rejects.toThrow("already set up");
	});

	test("sets the hashed password and clears the pending mark, unverified", async () => {
		const id = addUser("p@example.com", ["credential"], true);
		await AccountSetupService.complete("p@example.com", null, "long-enough-pw");
		expect(passwords.get(id)).toBe("hashed:long-enough-pw");
		expect(userUpdates).toEqual([]);
		expect(verifications.has(`account-setup:${id}`)).toBe(false);
		expect((await AccountSetupService.lookup("p@example.com")).step).toBe(
			"password",
		);
	});
});

describe("AccountSetupService.complete with SMTP", () => {
	async function pendingWithCode() {
		applyInstanceSettings(SMTP);
		const id = addUser("p@example.com", ["credential"], true);
		await AccountSetupService.resendCode("p@example.com");
		return { code: lastCode(), id };
	}

	test("the emailed code sets the password and verifies the address", async () => {
		const { code, id } = await pendingWithCode();
		await AccountSetupService.complete(
			"p@example.com",
			` ${code} `,
			"long-enough-pw",
		);
		expect(passwords.get(id)).toBe("hashed:long-enough-pw");
		expect(userUpdates).toEqual([[id, { emailVerified: true }]]);
		expect(verifications.size).toBe(0);
	});

	test("a wrong code counts an attempt, five wrong ones burn the code", async () => {
		const { code, id } = await pendingWithCode();
		const wrong = code === "000000" ? "111111" : "000000";
		for (let i = 1; i < 5; i++) {
			await expect(
				AccountSetupService.complete("p@example.com", wrong, "long-enough-pw"),
			).rejects.toThrow("That code didn't match.");
			const stored = verifications.get(`account-setup-code:${id}`);
			expect(JSON.parse(stored?.value ?? "{}").attempts).toBe(i);
		}
		await expect(
			AccountSetupService.complete("p@example.com", wrong, "long-enough-pw"),
		).rejects.toThrow("Too many wrong codes. Send a new one.");
		await expect(
			AccountSetupService.complete("p@example.com", code, "long-enough-pw"),
		).rejects.toThrow("That code expired. Send a new one.");
		expect(passwords.size).toBe(0);
	});

	test("a missing or expired code is refused", async () => {
		const { code, id } = await pendingWithCode();
		await expect(
			AccountSetupService.complete("p@example.com", null, "long-enough-pw"),
		).rejects.toThrow("That code didn't match.");

		const key = `account-setup-code:${id}`;
		const row = verifications.get(key) as Verification;
		verifications.set(key, { ...row, expiresAt: new Date(Date.now() - 1) });
		await expect(
			AccountSetupService.complete("p@example.com", code, "long-enough-pw"),
		).rejects.toThrow("That code expired.");
	});
});
