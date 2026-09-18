import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import type { z } from "zod";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

let clientAddress = "10.0.0.1";

function remote(schema: z.ZodType, fn: (arg: unknown) => unknown) {
	return async (arg: unknown) => await fn(schema.parse(arg));
}

mock.module("$app/server", () => ({
	command: remote,
	form: remote,
	getRequestEvent: () => ({ getClientAddress: () => clientAddress }),
	query: remote,
}));

mock.module("$lib/services/auth", () => ({
	auth: {},
	rebuildAuth: () => undefined,
}));

const { AccountSetupService } = await import(
	"../../../src/lib/services/account-setup.service"
);
const { completeAccountSetup, lookupSignIn, resendSetupCode } = await import(
	"../../../src/lib/remote/sign-in.remote"
);

const lookup = lookupSignIn as unknown as (email: string) => Promise<unknown>;
const resend = resendSetupCode as unknown as (email: string) => Promise<void>;
const complete = completeAccountSetup as unknown as (input: {
	code: string | null;
	email: string;
	password: string;
}) => Promise<void>;

let ip = 0;
let spies: { mockRestore: () => void }[] = [];
let calls: unknown[][] = [];

beforeEach(() => {
	ip += 1;
	clientAddress = `10.0.1.${ip}`;
	calls = [];
	spies = [
		spyOn(AccountSetupService, "lookup").mockImplementation(async (email) => {
			calls.push(["lookup", email]);
			return { providers: [], step: "password" };
		}),
		spyOn(AccountSetupService, "resendCode").mockImplementation(
			async (email) => {
				calls.push(["resend", email]);
			},
		),
		spyOn(AccountSetupService, "complete").mockImplementation(
			async (email, code, password) => {
				calls.push(["complete", email, code, password]);
			},
		),
	];
});

afterEach(() => {
	for (const spy of spies.reverse()) {
		spy.mockRestore();
	}
});

describe("sign-in remote commands", () => {
	test("normalise the email before handing it to the service", async () => {
		expect(await lookup("  Admin@Example.COM ")).toEqual({
			providers: [],
			step: "password",
		});
		await resend("Admin@Example.com");
		await complete({
			code: "123456",
			email: "ADMIN@example.com",
			password: "pw",
		});
		expect(calls).toEqual([
			["lookup", "admin@example.com"],
			["resend", "admin@example.com"],
			["complete", "admin@example.com", "123456", "pw"],
		]);
	});

	test("reject something that isn't an email", async () => {
		await expect(lookup("not-an-email")).rejects.toThrow();
		expect(calls).toEqual([]);
	});

	test("a setup failure becomes a 400 with the service's message", async () => {
		spies.push(
			spyOn(AccountSetupService, "complete").mockRejectedValue(
				new Error("That code didn't match."),
			),
		);
		await expect(
			complete({ code: "1", email: "a@example.com", password: "pw" }),
		).rejects.toMatchObject({
			body: { message: "That code didn't match." },
			status: 400,
		});
	});

	test("a non-Error failure gets a generic 400", async () => {
		spies.push(
			spyOn(AccountSetupService, "complete").mockRejectedValue("boom"),
		);
		await expect(
			complete({ code: null, email: "a@example.com", password: "pw" }),
		).rejects.toMatchObject({
			body: { message: "Couldn't set that up." },
			status: 400,
		});
	});
});

describe("sign-in throttle", () => {
	test("allows 20 calls a minute per IP and command, then 429s", async () => {
		for (let i = 0; i < 20; i++) {
			await lookup("a@example.com");
		}
		await expect(lookup("a@example.com")).rejects.toMatchObject({
			body: { message: "Too many attempts. Wait a minute and try again." },
			status: 429,
		});
		expect(calls).toHaveLength(20);

		await resend("a@example.com");
		clientAddress = "10.9.9.9";
		await lookup("a@example.com");
		expect(calls).toHaveLength(22);
	});

	test("HOMERUN_DISABLE_AUTH_RATE_LIMIT=1 turns it off", async () => {
		process.env.HOMERUN_DISABLE_AUTH_RATE_LIMIT = "1";
		try {
			for (let i = 0; i < 25; i++) {
				await lookup("a@example.com");
			}
			expect(calls).toHaveLength(25);
		} finally {
			delete process.env.HOMERUN_DISABLE_AUTH_RATE_LIMIT;
		}
	});

	test("attempts older than a minute stop counting", async () => {
		const realNow = Date.now;
		let now = realNow();
		const clock = spyOn(Date, "now").mockImplementation(() => now);
		try {
			for (let i = 0; i < 20; i++) {
				await lookup("a@example.com");
			}
			await expect(lookup("a@example.com")).rejects.toMatchObject({
				status: 429,
			});
			now += 60_001;
			await lookup("a@example.com");
			expect(calls).toHaveLength(21);
		} finally {
			clock.mockRestore();
		}
	});
});
