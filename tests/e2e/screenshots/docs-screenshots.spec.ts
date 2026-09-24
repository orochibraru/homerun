import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { expect, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "../support/config";

const OUT_DIR = join(process.cwd(), "docs", "images");
const AUTH_STATE = join(process.cwd(), "test-results", "screenshots-auth.json");
const EMAIL = "ada@example.com";
const PASSWORD = "a-real-strong-password-123";
const BASE_DOMAIN = "example.com";

const seeded: { stackId: string | null; serviceIds: Record<string, string> } = {
	stackId: null,
	serviceIds: {},
};

interface Seed {
	containerPort: number;
	deploy: boolean;
	envVars?: Record<string, string>;
	image: string;
	memoryLimitMb?: number;
	name: string;
	slug: string;
	tag: string;
}

const SEEDS: Seed[] = [
	{
		containerPort: 80,
		deploy: true,
		envVars: {
			NODE_ENV: "production",
			PUBLIC_BASE_URL: "https://web.example.com",
			SESSION_SECRET: "s3cr3t-rotate-me",
		},
		image: "nginx",
		memoryLimitMb: 512,
		name: "Marketing site",
		slug: "web",
		tag: "alpine",
	},
	{
		containerPort: 6379,
		deploy: true,
		image: "redis",
		memoryLimitMb: 256,
		name: "Cache",
		slug: "cache",
		tag: "alpine",
	},
	{
		containerPort: 8080,
		deploy: false,
		envVars: { DATABASE_URL: "postgres://api:api@db:5432/api" },
		image: "nginx",
		name: "API",
		slug: "api",
		tag: "alpine",
	},
];

interface Shot {
	doc: string;
	expect: RegExp;
	name: string;
	path: () => string;
	prepare?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
	{ doc: "/", expect: /Welcome back/i, name: "hero", path: () => "/" },
	{
		doc: "/services",
		expect: /Marketing site/i,
		name: "services",
		path: () => "/services",
	},
	{
		doc: "/services/:id",
		expect: /Marketing site/i,
		name: "service",
		path: () => `/services/${seeded.serviceIds.web}`,
	},
	{
		doc: "/services/:id/observability",
		expect: /Reconnect/i,
		name: "logs",
		path: () => `/services/${seeded.serviceIds.web}/observability`,
	},
	{
		doc: "/services/:id/revisions",
		expect: /Revisions/i,
		name: "revisions",
		path: () => `/services/${seeded.serviceIds.web}/revisions`,
	},
	{
		doc: "/services/:id/networking",
		expect: /Publicly routed at/i,
		name: "networking",
		path: () => `/services/${seeded.serviceIds.web}/networking`,
	},
	{
		doc: "/services/:id/env",
		expect: /Environment variables/i,
		name: "env",
		path: () => `/services/${seeded.serviceIds.web}/env`,
	},
	{
		doc: "/services/:id/compute",
		expect: /Memory limit/i,
		name: "compute",
		path: () => `/services/${seeded.serviceIds.web}/compute`,
	},
	{
		doc: "/services/new",
		expect: /Deploy a Service/i,
		name: "deploy",
		path: () => "/services/new",
	},
	{
		doc: "/templates",
		expect: /New Template/i,
		name: "templates",
		path: () => "/templates",
	},
	{
		doc: "/stacks/:id",
		expect: /Acme/i,
		name: "stack",
		path: () => `/stacks/${seeded.stackId}`,
	},
	{
		doc: "/settings",
		expect: /Base domain/i,
		name: "settings",
		path: () => "/settings",
	},
	{
		doc: "/users",
		expect: /Ada Admin/i,
		name: "users",
		path: () => "/users",
	},
];

async function capture(page: Page, name: string): Promise<void> {
	const png = await page.screenshot({ fullPage: false });
	const webp = await page.evaluate(async (base64) => {
		const bitmap = await createImageBitmap(
			new Blob([Uint8Array.fromBase64(base64)], { type: "image/png" }),
		);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
		const blob = await canvas.convertToBlob({
			quality: 0.9,
			type: "image/webp",
		});
		return new Uint8Array(await blob.arrayBuffer()).toBase64();
	}, png.toString("base64"));
	await writeFile(join(OUT_DIR, `${name}.webp`), Buffer.from(webp, "base64"));
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState("domcontentloaded");
	await page.waitForTimeout(1500);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
	await mkdir(OUT_DIR, { recursive: true });
});

test.afterAll(async ({ browser }) => {
	if (!seeded.stackId) {
		return;
	}
	const page = await browser.newPage({ storageState: AUTH_STATE });
	for (const id of Object.values(seeded.serviceIds)) {
		const removed = await page.request.delete(`/api/v1/services/${id}`, {
			timeout: 60_000,
		});
		expect(removed.ok(), `removing service ${id}`).toBeTruthy();
	}
	const stack = await page.request.post(
		`/stacks/${seeded.stackId}/settings?/delete`,
		{
			form: {},
			headers: { origin: E2E_BASE_URL, "x-sveltekit-action": "true" },
		},
	);
	expect(
		stack.ok(),
		`deleting stack ${seeded.stackId}: ${stack.status()}`,
	).toBeTruthy();
	await page.close();
});

test("bootstraps a blank instance", async ({ page }) => {
	await page.goto("/auth/sign-up");
	await page.locator("#name").fill("Ada Admin");
	await page.locator("#email").fill(EMAIL);
	await page.locator("#password").fill(PASSWORD);
	await page.locator("#confirm").fill(PASSWORD);
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page).toHaveURL(/\/onboarding$/);

	await page.locator("#baseDomain").fill(BASE_DOMAIN);
	for (let step = 0; step < 5; step++) {
		await page.getByRole("button", { name: "Next" }).click();
	}
	await page.getByRole("button", { name: "Finish setup" }).click();
	await expect(page).toHaveURL(/4310\/$/);

	await page.context().storageState({ path: AUTH_STATE });
});

test.describe("signed in", () => {
	test.use({ storageState: AUTH_STATE });

	test("seeds a stack and one service of each state", async ({ page }) => {
		const stack = await page.request.post("/api/v1/stacks", {
			data: {
				description: "Everything the marketing site needs to serve traffic.",
				name: "Acme",
				slug: "acme",
			},
		});
		expect(stack.ok()).toBeTruthy();
		seeded.stackId = (await stack.json()).id;

		for (const seed of SEEDS) {
			const created = await page.request.post("/api/v1/services", {
				data: {
					containerPort: seed.containerPort,
					envVars: seed.envVars ?? {},
					image: seed.image,
					memoryLimitMb: seed.memoryLimitMb,
					name: seed.name,
					stackId: seeded.stackId,
					slug: seed.slug,
					tag: seed.tag,
				},
			});
			expect(created.ok()).toBeTruthy();
			seeded.serviceIds[seed.slug] = (await created.json()).id;
		}
	});

	test("deploys the ones that should be running", async ({ page }) => {
		for (const seed of SEEDS.filter((s) => s.deploy)) {
			const deployed = await page.request.post(
				`/api/v1/services/${seeded.serviceIds[seed.slug]}/deploy`,
				{ timeout: 180_000 },
			);
			expect(
				deployed.ok(),
				`deploying ${seed.slug}: ${await deployed.text()}`,
			).toBeTruthy();
		}
	});

	for (const shot of SHOTS) {
		for (const theme of ["light", "dark"] as const) {
			test(`captures ${shot.name} (${theme})`, async ({ page }) => {
				await page.emulateMedia({ colorScheme: theme });

				const path = shot.path();
				await page.goto(path);
				expect(new URL(page.url()).pathname).toBe(path);
				await expect(page.getByText(shot.expect).first()).toBeVisible({
					timeout: 15_000,
				});

				await shot.prepare?.(page);
				await settle(page);

				await capture(page, `${shot.name}${theme === "dark" ? "-dark" : ""}`);
			});
		}
	}
});

for (const theme of ["light", "dark"] as const) {
	test(`captures sign-in (${theme})`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: theme });
		await page.goto("/auth/sign-in");
		await expect(page.getByText(/Sign in/i).first()).toBeVisible({
			timeout: 15_000,
		});
		await page.locator("#email").fill(EMAIL);
		await page.getByRole("button", { exact: true, name: "Continue" }).click();
		await page.locator("#password").fill(PASSWORD);
		await settle(page);
		await capture(page, `sign-in${theme === "dark" ? "-dark" : ""}`);
	});
}

test("writes an index of what was captured", async () => {
	const lines = [...SHOTS, { doc: "/auth/sign-in", name: "sign-in" }].flatMap(
		(shot) =>
			["", "-dark"].map(
				(suffix) => `- \`${shot.name}${suffix}.webp\` — ${shot.doc}`,
			),
	);
	await writeFile(
		join(OUT_DIR, "README.md"),
		[
			"# Screenshots",
			"",
			"Generated by `bun run screenshots`. Do not edit by hand.",
			"",
			"They are published by `docs/showcase.md`, which is what the README links to —",
			"there is no demo instance.",
			"",
			...lines,
			"",
		].join("\n"),
	);
});
