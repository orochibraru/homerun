import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { PackageRegistryDTO } =
	await import("../../../src/lib/dto/package-registry-dto");
const { PackageRegistryTokenDTO } =
	await import("../../../src/lib/dto/package-registry-token-dto");
const hostnameOwnerModule =
	await import("../../../src/lib/server/hostname-owner");
const dnsModule = await import("../../../src/lib/services/dns.service");
const { DockerService } =
	await import("../../../src/lib/services/docker.service");
const { PackageRegistryService } =
	await import("../../../src/lib/services/package-registry.service");

type Settings = NonNullable<Awaited<ReturnType<typeof PackageRegistryDTO.get>>>;
type Token = Awaited<ReturnType<typeof PackageRegistryTokenDTO.create>>;

const restorers: { mockRestore: () => void }[] = [];

let stored: { enabled: boolean; kind: "npm"; publicHost: string | null } | null;
const deleted: string[] = [];

function settings(): Settings | null {
	return stored ? (stored as unknown as Settings) : null;
}

function token(username: string): Token {
	return {
		delete: async () => {
			deleted.push(username);
		},
		secretHash: `hash-of-${username}`,
		toJSON: () => ({ id: `id-${username}` }),
		username,
	} as unknown as Token;
}

const reconcile = spyOn(DockerService, "reconcilePackageRegistry");
const syncDns = spyOn(dnsModule, "syncCoreHostDns");

beforeEach(() => {
	stored = null;
	deleted.length = 0;
	reconcile.mockReset();
	reconcile.mockResolvedValue();
	syncDns.mockReset();
	syncDns.mockResolvedValue();
	restorers.push(
		spyOn(PackageRegistryDTO, "get").mockImplementation(async () => settings()),
		spyOn(PackageRegistryDTO, "list").mockImplementation(async () =>
			stored ? [stored as unknown as Settings] : [],
		),
		spyOn(PackageRegistryDTO, "save").mockImplementation(
			async (kind, input) => {
				stored = { kind: "npm", ...input };
				return stored as unknown as Settings;
			},
		),
		spyOn(PackageRegistryTokenDTO, "list").mockResolvedValue([token("ci")]),
		spyOn(PackageRegistryTokenDTO, "usernameTaken").mockImplementation(
			async (_kind, username) => username === "taken",
		),
		spyOn(PackageRegistryTokenDTO, "create").mockImplementation(async (input) =>
			token(input.username),
		),
		spyOn(hostnameOwnerModule, "hostnameOwner").mockImplementation(
			async (host) =>
				host === "blog.example.com" ? 'the service "Blog"' : null,
		),
	);
});

afterEach(() => {
	for (const spy of restorers.splice(0)) {
		spy.mockRestore();
	}
});

afterAll(() => {
	reconcile.mockRestore();
	syncDns.mockRestore();
});

describe("PackageRegistryService.publicHostProblem", () => {
	test("an empty host is fine, a malformed or taken one is refused", async () => {
		expect(
			await PackageRegistryService.publicHostProblem("npm", ""),
		).toBeNull();
		expect(
			await PackageRegistryService.publicHostProblem("npm", "not a host"),
		).toContain("isn't a hostname");
		expect(
			await PackageRegistryService.publicHostProblem("npm", "blog.example.com"),
		).toBe('blog.example.com is already used by the service "Blog".');
	});

	test("the registry's own current host isn't a conflict with itself", async () => {
		stored = { enabled: true, kind: "npm", publicHost: "blog.example.com" };
		expect(
			await PackageRegistryService.publicHostProblem("npm", "Blog.example.com"),
		).toBeNull();
	});
});

describe("PackageRegistryService.configure", () => {
	test("turning it on writes every token into the htpasswd and syncs the host's DNS", async () => {
		await PackageRegistryService.configure("npm", true, "NPM.example.com");
		expect(stored).toEqual({
			enabled: true,
			kind: "npm",
			publicHost: "npm.example.com",
		});
		expect(reconcile).toHaveBeenCalledWith("npm", {
			htpasswd: "ci:hash-of-ci",
			publicHost: "npm.example.com",
		});
		expect(syncDns).toHaveBeenCalledWith(
			"npm Registry",
			null,
			"npm.example.com",
		);
	});

	test("turning it off removes the container and the host's DNS record", async () => {
		stored = { enabled: true, kind: "npm", publicHost: "npm.example.com" };
		await PackageRegistryService.configure("npm", false, "npm.example.com");
		expect(reconcile).toHaveBeenCalledWith("npm", null);
		expect(syncDns).toHaveBeenCalledWith(
			"npm Registry",
			"npm.example.com",
			null,
		);
	});
});

describe("PackageRegistryService tokens", () => {
	test("a bad or taken username is refused before anything is written", async () => {
		await expect(
			PackageRegistryService.createToken("npm", "A", "user-1"),
		).rejects.toThrow("3 to 32 characters");
		await expect(
			PackageRegistryService.createToken("npm", "taken", "user-1"),
		).rejects.toThrow('"taken" already has a token.');
		expect(reconcile).not.toHaveBeenCalled();
	});

	test("a new token's secret comes back once, and the token goes again if the rewrite fails", async () => {
		stored = { enabled: true, kind: "npm", publicHost: null };
		const created = await PackageRegistryService.createToken(
			"npm",
			"deploy-bot",
			"user-1",
		);
		expect(created.username).toBe("deploy-bot");
		expect(created.secret.length).toBeGreaterThan(30);

		reconcile.mockRejectedValueOnce(new Error("worker down"));
		await expect(
			PackageRegistryService.createToken("npm", "second-bot", "user-1"),
		).rejects.toThrow("worker down");
		expect(deleted).toEqual(["second-bot"]);
	});

	test("revoking an unknown token says so", async () => {
		restorers.push(
			spyOn(PackageRegistryTokenDTO, "get").mockResolvedValue(null),
		);
		await expect(
			PackageRegistryService.revokeToken("npm", "missing"),
		).rejects.toThrow("no longer exists");
	});
});

describe("PackageRegistryService.reassert", () => {
	test("brings back only the registries that are on", async () => {
		await PackageRegistryService.reassert();
		expect(reconcile).not.toHaveBeenCalled();
		stored = { enabled: true, kind: "npm", publicHost: "npm.example.com" };
		await PackageRegistryService.reassert();
		expect(reconcile).toHaveBeenCalledTimes(1);
		expect(syncDns).toHaveBeenCalledWith(
			"npm Registry",
			null,
			"npm.example.com",
		);
	});
});
