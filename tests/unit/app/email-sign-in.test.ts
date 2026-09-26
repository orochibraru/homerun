import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { createHash } from "node:crypto";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

interface Verification {
	expiresAt: Date;
	value: string;
}

interface FakeUser {
	user: { emailVerified: boolean; id: string };
}

const verifications = new Map<string, Verification>();
const users = new Map<string, FakeUser>();
const userUpdates: [string, Record<string, unknown>][] = [];

const adapter = {
	deleteVerificationByIdentifier: async (identifier: string) => {
		verifications.delete(identifier);
	},
	findUserByEmail: async (email: string) => users.get(email) ?? null,
	findVerificationValue: async (identifier: string) =>
		verifications.get(identifier) ?? null,
	updateUser: async (userId: string, data: { emailVerified: boolean }) => {
		userUpdates.push([userId, data]);
	},
};

mock.module("$lib/services/auth", () => ({
	auth: { $context: Promise.resolve({ internalAdapter: adapter }) },
	rebuildAuth: () => undefined,
}));

const { applyInstanceSettings, config } = await import(
	"../../../src/lib/config"
);
const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);
const { EmailService } = await import(
	"../../../src/lib/services/email.service"
);
const {
	accountSetupPendingKey,
	emailSignInAvailability,
	emailSignInPlugins,
	guardEmailSignIn,
	magicLinkEmail,
	magicLinkLandingUrl,
	signInCodeEmail,
	signInLinkEmail,
	storedCodeMatches,
} = await import("../../../src/lib/services/email-sign-in");

const SMTP = {
	smtpEnabled: true,
	smtpFrom: "homerun@example.com",
	smtpHost: "smtp.example.com",
	smtpPassword: "pw",
	smtpPort: 587,
	smtpUser: "mailer",
};

const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const inTenMinutes = () => new Date(Date.now() + 600_000);

let sent: { content: string; subject: string; to: string }[] = [];
let emailSignIn = { emailOtp: true, magicLink: true };
let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
	verifications.clear();
	users.clear();
	userUpdates.length = 0;
	sent = [];
	emailSignIn = { emailOtp: true, magicLink: true };
	applyInstanceSettings(SMTP);
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
				({ emailSignIn }) as unknown as Awaited<
					ReturnType<typeof InstanceSettingsDTO.get>
				>,
		),
	];
});

afterEach(() => {
	for (const spy of spies.reverse()) {
		spy.mockRestore();
	}
	applyInstanceSettings({});
});

describe("storedCodeMatches", () => {
	test("matches the right code, trimmed, while live with tries left", () => {
		const stored = {
			expiresAt: inTenMinutes(),
			value: `${sha256("123456")}:2`,
		};
		expect(storedCodeMatches(stored, " 123456 ")).toBe(true);
		expect(storedCodeMatches(stored, "654321")).toBe(false);
		expect(
			storedCodeMatches({ ...stored, value: sha256("123456") }, "123456"),
		).toBe(true);
	});

	test("refuses an expired or used-up code, and a mangled value", () => {
		const value = `${sha256("123456")}:0`;
		expect(
			storedCodeMatches(
				{ expiresAt: new Date(Date.now() - 1), value },
				"123456",
			),
		).toBe(false);
		expect(
			storedCodeMatches(
				{ expiresAt: inTenMinutes(), value: `${sha256("123456")}:5` },
				"123456",
			),
		).toBe(false);
		expect(
			storedCodeMatches({ expiresAt: inTenMinutes(), value: "short:0" }, "1"),
		).toBe(false);
	});
});

describe("emailSignInAvailability", () => {
	test("is the admin's switches, and nothing without SMTP", async () => {
		emailSignIn = { emailOtp: false, magicLink: true };
		expect(await emailSignInAvailability()).toEqual(emailSignIn);
		applyInstanceSettings({});
		expect(await emailSignInAvailability()).toEqual({
			emailOtp: false,
			magicLink: false,
		});
	});
});

describe("emails", () => {
	test("the code email names the code, its expiry and the instance", () => {
		config.auth.origin = "https://homerun.example.com";
		const mail = signInCodeEmail("042042");
		expect(mail.subject).toBe("042042 is your Homerun sign-in code");
		expect(mail.content).toContain("    042042");
		expect(mail.content).toContain("expires in 10 minutes");
		expect(mail.content).toContain("at https://homerun.example.com");
	});

	test("the link email carries the link", () => {
		const mail = signInLinkEmail("https://h.example.com/auth/magic-link?t=1");
		expect(mail.subject).toBe("Your Homerun sign-in link");
		expect(mail.content).toContain("https://h.example.com/auth/magic-link?t=1");
	});

	test("the link lands on the Dashboard URL's own page with a safe redirect", () => {
		config.auth.origin = "https://homerun.example.com";
		const verify =
			"http://10.0.0.2:3000/api/v1/auth/magic-link/verify?token=abc&callbackURL=%2F";
		const url = new URL(
			magicLinkLandingUrl(verify, "abc", "/app-auth?rd=signed"),
		);
		expect(url.origin).toBe("https://homerun.example.com");
		expect(url.pathname).toBe("/auth/magic-link");
		expect(url.searchParams.get("token")).toBe("abc");
		expect(url.searchParams.get("redirectTo")).toBe("/app-auth?rd=signed");
		expect(
			new URL(
				magicLinkLandingUrl(verify, "abc", "https://evil.example.com"),
			).searchParams.has("redirectTo"),
		).toBe(false);
		expect(
			new URL(magicLinkLandingUrl(verify, "abc", 42)).searchParams.has(
				"redirectTo",
			),
		).toBe(false);
	});
});

describe("guardEmailSignIn", () => {
	function unverified(email: string, pending = false) {
		const id = `id-${email}`;
		users.set(email, { user: { emailVerified: false, id } });
		if (pending) {
			verifications.set(accountSetupPendingKey(id), {
				expiresAt: inTenMinutes(),
				value: "pending",
			});
		}
		return id;
	}

	test("ignores every other path", async () => {
		emailSignIn = { emailOtp: false, magicLink: false };
		await guardEmailSignIn({ path: "/sign-in/email" }, adapter);
	});

	test("refuses a method that's switched off, or everything without SMTP", async () => {
		emailSignIn = { emailOtp: false, magicLink: true };
		await expect(
			guardEmailSignIn(
				{
					body: { email: "a@example.com", type: "sign-in" },
					path: "/email-otp/send-verification-otp",
				},
				adapter,
			),
		).rejects.toThrow("emailed code is turned off");
		await guardEmailSignIn(
			{ body: { email: "a@example.com" }, path: "/sign-in/magic-link" },
			adapter,
		);

		applyInstanceSettings({});
		await expect(
			guardEmailSignIn(
				{ body: { email: "a@example.com" }, path: "/sign-in/magic-link" },
				adapter,
			),
		).rejects.toThrow("emailed link is turned off");
	});

	test("only sign-in codes can be requested", async () => {
		await expect(
			guardEmailSignIn(
				{
					body: { email: "a@example.com", type: "forget-password" },
					path: "/email-otp/send-verification-otp",
				},
				adapter,
			),
		).rejects.toThrow("Only sign-in codes can be requested.");
	});

	test("the right code proves an unverified account and ends its pending setup", async () => {
		const id = unverified("client@example.com", true);
		verifications.set("sign-in-otp-client@example.com", {
			expiresAt: inTenMinutes(),
			value: `${sha256("123456")}:0`,
		});
		await guardEmailSignIn(
			{
				body: { email: "client@example.com", otp: "999999" },
				path: "/sign-in/email-otp",
			},
			adapter,
		);
		expect(userUpdates).toEqual([]);

		await guardEmailSignIn(
			{
				body: { email: "Client@Example.com", otp: "123456" },
				path: "/sign-in/email-otp",
			},
			adapter,
		);
		expect(userUpdates).toEqual([[id, { emailVerified: true }]]);
		expect(verifications.has(accountSetupPendingKey(id))).toBe(false);
	});

	test("a verified account is left alone, an unknown email is a no-op", async () => {
		users.set("done@example.com", {
			user: { emailVerified: true, id: "done" },
		});
		for (const email of ["done@example.com", "ghost@example.com"]) {
			verifications.set(`sign-in-otp-${email}`, {
				expiresAt: inTenMinutes(),
				value: `${sha256("123456")}:0`,
			});
			await guardEmailSignIn(
				{ body: { email, otp: "123456" }, path: "/sign-in/email-otp" },
				adapter,
			);
		}
		expect(userUpdates).toEqual([]);
	});

	test("a live link proves its account, a dead one doesn't", async () => {
		const id = unverified("client@example.com");
		verifications.set(sha256("expired"), {
			expiresAt: new Date(Date.now() - 1),
			value: JSON.stringify({ email: "client@example.com" }),
		});
		await guardEmailSignIn(
			{ path: "/magic-link/verify", query: { token: "expired" } },
			adapter,
		);
		await guardEmailSignIn(
			{ path: "/magic-link/verify", query: { token: "unknown" } },
			adapter,
		);
		expect(userUpdates).toEqual([]);

		verifications.set(sha256("live"), {
			expiresAt: inTenMinutes(),
			value: JSON.stringify({ email: "client@example.com" }),
		});
		await guardEmailSignIn(
			{ path: "/magic-link/verify", query: { token: "live" } },
			adapter,
		);
		expect(userUpdates).toEqual([[id, { emailVerified: true }]]);
	});
});

describe("magicLinkEmail", () => {
	test("peeks at a live link's email without spending it", async () => {
		verifications.set(sha256("live"), {
			expiresAt: inTenMinutes(),
			value: JSON.stringify({ email: "client@example.com" }),
		});
		verifications.set(sha256("old"), {
			expiresAt: new Date(Date.now() - 1),
			value: JSON.stringify({ email: "client@example.com" }),
		});
		expect(await magicLinkEmail("live")).toBe("client@example.com");
		expect(verifications.has(sha256("live"))).toBe(true);
		expect(await magicLinkEmail("old")).toBeNull();
		expect(await magicLinkEmail("nope")).toBeNull();
	});
});

describe("emailSignInPlugins", () => {
	const [otp, link, guard] = emailSignInPlugins();

	test("codes and links can't create accounts and expire in 10 minutes", () => {
		expect(otp.options).toMatchObject({
			allowedAttempts: 5,
			disableSignUp: true,
			expiresIn: 600,
		});
		expect(link.options).toMatchObject({ disableSignUp: true, expiresIn: 600 });
		expect(guard.id).toBe("homerun-email-sign-in");
		const [hook] = guard.hooks.before;
		expect(hook.matcher({ path: "/sign-in/email-otp" } as never)).toBe(true);
		expect(hook.matcher({ path: "/sign-in/email" } as never)).toBe(false);
	});

	test("secrets are stored as their SHA-256", async () => {
		const store = otp.options.storeOTP as {
			hash: (v: string) => Promise<string>;
		};
		expect(await store.hash("123456")).toBe(sha256("123456"));
	});

	test("the code goes out through Homerun's SMTP sender", async () => {
		await otp.options.sendVerificationOTP({
			email: "client@example.com",
			otp: "123456",
			type: "sign-in",
		});
		expect(sent).toEqual([
			{ ...signInCodeEmail("123456"), to: "client@example.com" },
		]);
	});

	test("a link is only emailed to an existing account", async () => {
		config.auth.origin = "https://homerun.example.com";
		const ctx = { context: { internalAdapter: adapter } } as never;
		const send = link.options.sendMagicLink;
		const input = {
			email: "client@example.com",
			metadata: { redirectTo: "/my-apps" },
			token: "tok",
			url: "https://homerun.example.com/api/v1/auth/magic-link/verify?token=tok",
		};
		await send(input, ctx);
		expect(sent).toEqual([]);

		users.set("client@example.com", {
			user: { emailVerified: true, id: "c" },
		});
		await send(input, ctx);
		expect(sent).toHaveLength(1);
		expect(sent[0].content).toContain(
			"https://homerun.example.com/auth/magic-link?token=tok&redirectTo=%2Fmy-apps",
		);
	});
});
