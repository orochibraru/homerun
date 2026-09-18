import {
	afterAll,
	afterEach,
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

const refreshToken = mock(
	async (_input: { body: { accountId: string; userId: string } }) => ({}),
);

mock.module("$lib/services/auth", () => ({
	auth: { api: { refreshToken } },
	rebuildAuth: () => undefined,
}));

const { db } = await import("../../../src/lib/server/db/lib");
const { account: accountTable, user: userTable } = await import(
	"../../../src/lib/server/db/schema"
);
const { ACCESS_DENIAL_MESSAGES, AppAccessService } = await import(
	"../../../src/lib/services/app-access.service"
);

type Service = Parameters<typeof AppAccessService.evaluate>[0];

interface UserRow {
	banExpires: Date | null;
	banned: boolean | null;
	email: string;
	role: string | null;
}

interface AccountRow {
	id: string;
	idToken: string | null;
	providerId: string;
	refreshToken: string | null;
}

const tables = { accounts: [] as AccountRow[], users: [] as UserRow[] };

function rowsQuery(rows: unknown[]) {
	const result = Promise.resolve(rows);
	return Object.assign(result, { limit: async () => rows });
}

const selectSpy = spyOn(db, "select").mockImplementation((() => ({
	from: (table: unknown) => ({
		where: () =>
			rowsQuery(
				table === userTable
					? tables.users
					: table === accountTable
						? tables.accounts
						: [],
			),
	}),
})) as unknown as typeof db.select);

afterAll(() => {
	selectSpy.mockRestore();
});

afterEach(() => {
	tables.users = [];
	tables.accounts = [];
	refreshToken.mockReset();
	refreshToken.mockImplementation(async () => ({}));
});

function idTokenWith(claims: Record<string, unknown>): string {
	return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

function service(overrides: Partial<Record<string, string[]>> = {}): Service {
	return {
		authAllowedEmails: [],
		authAllowedGroups: [],
		authAllowedUserIds: [],
		authProviders: ["oauth:keycloak"],
		...overrides,
	} as unknown as Service;
}

const ada: UserRow = {
	banExpires: null,
	banned: false,
	email: "ada@example.com",
	role: "user",
};

function keycloakAccount(groups: string[], id = "acc-1"): AccountRow {
	return {
		id,
		idToken: idTokenWith({ groups }),
		providerId: "keycloak",
		refreshToken: "rt",
	};
}

describe("AppAccessService.evaluate", () => {
	test("nobody passes a wall with no sign-in method", async () => {
		expect(
			await AppAccessService.evaluate(service({ authProviders: [] }), "u1"),
		).toEqual({ allowed: false, reason: "no-method-configured" });
	});

	test("an explicit user list shuts everyone else out before touching the DB", async () => {
		selectSpy.mockClear();
		expect(
			await AppAccessService.evaluate(
				service({ authAllowedUserIds: ["u2"] }),
				"u1",
			),
		).toEqual({ allowed: false, reason: "user-not-allowed" });
		expect(selectSpy).not.toHaveBeenCalled();
	});

	test("a deleted or banned user is refused", async () => {
		tables.accounts = [keycloakAccount([])];
		expect(await AppAccessService.evaluate(service(), "u1")).toEqual({
			allowed: false,
			reason: "user-not-allowed",
		});
		tables.users = [{ ...ada, banned: true }];
		expect(await AppAccessService.evaluate(service(), "u1")).toEqual({
			allowed: false,
			reason: "user-not-allowed",
		});
	});

	test("the email allowlist accepts wildcards and refuses anyone else", async () => {
		tables.users = [ada];
		tables.accounts = [keycloakAccount([])];
		expect(
			await AppAccessService.evaluate(
				service({ authAllowedEmails: ["*@example.com"] }),
				"u1",
			),
		).toEqual({ allowed: true });
		expect(
			await AppAccessService.evaluate(
				service({ authAllowedEmails: ["bob@example.com"] }),
				"u1",
			),
		).toEqual({ allowed: false, reason: "email-not-allowed" });
	});

	test("an account linked only to another method is refused", async () => {
		tables.users = [ada];
		tables.accounts = [
			{ id: "a", idToken: null, providerId: "credential", refreshToken: null },
		];
		expect(await AppAccessService.evaluate(service(), "u1")).toEqual({
			allowed: false,
			reason: "method-not-linked",
		});
		expect(
			await AppAccessService.evaluate(
				service({ authProviders: ["password"] }),
				"u1",
			),
		).toEqual({ allowed: true });
	});

	test("groups come from the provider's id token or the Homerun role", async () => {
		tables.users = [ada];
		tables.accounts = [keycloakAccount(["devs"])];
		expect(
			await AppAccessService.evaluate(
				service({ authAllowedGroups: ["devs"] }),
				"u1",
			),
		).toEqual({ allowed: true });
		expect(
			await AppAccessService.evaluate(
				service({ authAllowedGroups: ["user"] }),
				"u1",
			),
		).toEqual({ allowed: true });
		expect(
			await AppAccessService.evaluate(
				service({ authAllowedGroups: ["admins"] }),
				"u1",
			),
		).toEqual({ allowed: false, reason: "group-not-allowed" });
	});

	test("every denial reason has a message", () => {
		for (const message of Object.values(ACCESS_DENIAL_MESSAGES)) {
			expect(message.length).toBeGreaterThan(0);
		}
	});
});

describe("AppAccessService.recheck", () => {
	test("without a group filter it never asks the provider for fresh tokens", async () => {
		tables.users = [ada];
		tables.accounts = [keycloakAccount([])];
		expect(await AppAccessService.recheck(service(), "plain-user")).toBe(true);
		expect(refreshToken).not.toHaveBeenCalled();
	});

	test("with a group filter it refreshes OAuth accounts at most once every five minutes", async () => {
		tables.users = [ada];
		tables.accounts = [
			keycloakAccount(["devs"], "acc-kc"),
			{
				id: "acc-pw",
				idToken: null,
				providerId: "credential",
				refreshToken: "x",
			},
		];
		const svc = service({
			authAllowedGroups: ["devs"],
			authProviders: ["oauth:keycloak", "password"],
		});

		expect(await AppAccessService.recheck(svc, "grouped-user")).toBe(true);
		expect(refreshToken).toHaveBeenCalledTimes(1);
		expect(refreshToken.mock.calls[0][0]).toEqual({
			body: { accountId: "acc-kc", userId: "grouped-user" },
		});

		await AppAccessService.recheck(svc, "grouped-user");
		expect(refreshToken).toHaveBeenCalledTimes(1);

		const realNow = Date.now;
		Date.now = () => realNow() + 6 * 60 * 1000;
		try {
			await AppAccessService.recheck(svc, "grouped-user");
		} finally {
			Date.now = realNow;
		}
		expect(refreshToken).toHaveBeenCalledTimes(2);
	});

	test("a failed refresh falls back to the stored token's groups", async () => {
		tables.users = [ada];
		tables.accounts = [keycloakAccount(["devs"])];
		refreshToken.mockImplementation(async () => {
			throw new Error("provider down");
		});
		expect(
			await AppAccessService.recheck(
				service({ authAllowedGroups: ["devs"] }),
				"failing-refresh-user",
			),
		).toBe(true);
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	test("no refreshable account means no refresh call, and the group check still applies", async () => {
		tables.users = [ada];
		tables.accounts = [{ ...keycloakAccount(["devs"]), refreshToken: null }];
		expect(
			await AppAccessService.recheck(
				service({ authAllowedGroups: ["ops"] }),
				"no-refresh-user",
			),
		).toBe(false);
		expect(refreshToken).not.toHaveBeenCalled();
	});
});

describe("AppAccessService.linkedMethods", () => {
	test("maps provider ids to distinct sign-in methods", async () => {
		tables.accounts = [
			keycloakAccount([], "a"),
			keycloakAccount([], "b"),
			{ id: "c", idToken: null, providerId: "credential", refreshToken: null },
		];
		expect((await AppAccessService.linkedMethods("u1")).sort()).toEqual([
			"oauth:keycloak",
			"password",
		]);
	});
});
