import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
	cleanUpThrowawayAccount,
	makeThrowawayUser,
	signUpThrowawayUser,
} from "./helpers";

/**
 * Covers the System Logs page's Traefik restart/update controls
 * (src/lib/server/docker/core-services.ts's restartTraefikContainer /
 * updateTraefikContainer, wired into system-logs/+page.server.ts's
 * restartTraefik / updateTraefik actions) — admin-only, both confirm()-gated.
 *
 * Real Docker side effects are asserted via `docker inspect` against the
 * live compose-bootstrapped Traefik container, not just trusted from the
 * UI's own success toast — a dockerode call succeeding is only as
 * trustworthy as observing the real side effect.
 *
 * Traefik itself is NOT `homerun.managed=true` labeled (a deliberate, narrow
 * exception documented in core-services.ts), so it's located by image name
 * here too, the same way findTraefikContainer() does — never assume a fixed
 * container name.
 */

const UPDATE_RESULT_RE =
	/Already running the latest|Updated to .* and restarted\./;

function traefikContainerId(): string {
	const out = execSync("docker ps -a --format '{{.ID}} {{.Image}}'").toString();
	const line = out
		.split("\n")
		.find((l) => l.trim().split(" ")[1]?.startsWith("traefik"));
	if (!line) {
		throw new Error("No traefik container found via `docker ps -a`.");
	}
	const id = line.trim().split(" ")[0];
	if (!id) {
		throw new Error(
			`Couldn't parse a container id from docker ps line: ${line}`,
		);
	}
	return id;
}

function traefikStartedAt(id: string): string {
	return execSync(`docker inspect ${id} --format '{{.State.StartedAt}}'`)
		.toString()
		.trim();
}

function traefikRunning(id: string): boolean {
	return (
		execSync(`docker inspect ${id} --format '{{.State.Running}}'`)
			.toString()
			.trim() === "true"
	);
}

const admin = makeThrowawayUser("syslogs-admin");
const devUser = makeThrowawayUser("syslogs-dev");
const devPassword = "playwright-test-password-dev12";

test("admin can restart/update Traefik from System Logs; a developer can't see the controls", async ({
	page,
	browser,
}) => {
	// Real docker pull + container recreate, not mocked.
	test.setTimeout(180_000);

	let devContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

	try {
		await test.step("sign up admin (first account on the isolated test DB becomes the instance admin)", async () => {
			await signUpThrowawayUser(page, admin);
			await expect(page).toHaveURL("/");
		});

		await test.step("admin sees Restart/Update buttons on System Logs", async () => {
			await page.goto("/system-logs");
			await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
			await expect(page.getByRole("button", { name: "Update" })).toBeVisible();
		});

		await test.step("Restart really restarts the live Traefik container", async () => {
			const id = traefikContainerId();
			const startedBefore = traefikStartedAt(id);

			page.once("dialog", (d) => d.accept());
			await page.getByRole("button", { name: "Restart" }).click();
			await expect(page.getByText("Traefik restarted.")).toBeVisible({
				timeout: 15_000,
			});

			await expect
				.poll(() => traefikStartedAt(id), { timeout: 15_000 })
				.not.toBe(startedBefore);
			expect(traefikRunning(id)).toBe(true);
		});

		await test.step("Update completes without error (either 'already latest' or a real recreate is a pass)", async () => {
			page.once("dialog", (d) => d.accept());
			await page.getByRole("button", { name: "Update" }).click();
			await expect(page.getByText(UPDATE_RESULT_RE)).toBeVisible({
				timeout: 60_000,
			});
			await expect(page.getByText("Couldn't update Traefik.")).toHaveCount(0);

			// Whether or not it actually recreated the container, Traefik must
			// still be there and running afterward — this is the real infra the
			// maintainer depends on, not a throwaway per-test container.
			const id = traefikContainerId();
			expect(traefikRunning(id)).toBe(true);
		});

		await test.step("admin direct-creates a developer account", async () => {
			await page.goto("/users");
			await page.getByRole("button", { name: "Add user" }).click();
			await page.locator("#name").fill(devUser.name);
			await page.locator("#email").fill(devUser.email);
			await page.locator("#password").fill(devPassword);
			await page.getByRole("button", { name: "Create user" }).click();
			await expect(page.getByText("User created.")).toBeVisible({
				timeout: 10_000,
			});
		});

		await test.step("a developer does not see Restart/Update on System Logs", async () => {
			devContext = await browser.newContext();
			const devPage = await devContext.newPage();
			await devPage.goto("/auth/sign-in");
			await devPage.locator("#email").fill(devUser.email);
			await devPage.locator("#password").fill(devPassword);
			await devPage.getByRole("button", { name: "Sign in" }).click();
			await devPage.waitForURL("/", { timeout: 15_000 });

			await devPage.goto("/system-logs");
			await expect(
				devPage.getByRole("button", { name: "Restart" }),
			).toHaveCount(0);
			await expect(devPage.getByRole("button", { name: "Update" })).toHaveCount(
				0,
			);
		});
	} finally {
		await test.step("clean up: remove the developer account, then delete the admin account", async () => {
			if (devContext) {
				await devContext.close();
			}
			// The developer never mutated any instance-wide state, so cleanup is
			// just removing the account — done by the admin via /users, same as
			// the app's own real "remove a user" path (also exercises
			// cleanupUserResources for that account, harmless no-op here since it
			// never created any services).
			await page.goto("/users");
			const row = page.locator(
				"div.rounded-2xl.border.border-border.bg-surface.p-4",
				{
					hasText: devUser.email,
				},
			);
			if (await row.count()) {
				page.once("dialog", (d) => d.accept());
				await row.getByRole("button", { name: "Remove user" }).click();
				await expect(page.getByText("User removed.")).toBeVisible({
					timeout: 10_000,
				});
			}
			await cleanUpThrowawayAccount(page, admin.password);
		});
	}
});
