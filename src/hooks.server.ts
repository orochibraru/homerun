import { join } from "node:path";
import process, { cwd } from "node:process";
import type { Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { building } from "$app/environment";
import { applyInstanceSettings } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { db as appDb, getDb, resetDb } from "$lib/server/db";
import { user as userTable } from "$lib/server/db/schema";
import { seedBuiltinTemplates } from "$lib/server/db/seed";
import { AdminService } from "$lib/services/admin.service";
import { auth, rebuildAuth } from "$lib/services/auth";
import { CronService } from "$lib/services/cron.service";

const logger = new Logger("Hooks");

const migrationsFolder = join(cwd(), "drizzle");

export function handleError({ event, error, status }) {
	if (status !== 404) {
		logger.error(
			`Error on ${event.request.method} ${event.url.pathname}`,
			error,
		);
		if (error instanceof Error) {
			return new Error(error.message);
		}

		return new Error("An unknown error occured.");
	}
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase() {
	const maxRetries = 10;
	const retryDelay = 2000;

	for (let i = 0; i < maxRetries; i += 1) {
		try {
			// Reset connection before each attempt to avoid stale connections
			if (i > 0) {
				await resetDb();
			}
			// getDb() alone doesn't prove connectivity : drizzle-orm/bun-sql's
			// client is lazy (unlike bun:sqlite's `new Database(path)`, which
			// used to fail synchronously on an inaccessible path here). A
			// trivial real query is what actually verifies Postgres is up.
			const db = getDb();
			await db.execute("select 1");
			logger.info("Database connection established.");
			return;
		} catch (error) {
			if (i === maxRetries - 1) {
				logger.error("Database not ready after maximum retries.");
				logger.error(`Last error: ${error}`);
				throw error;
			}
			const isFirstAttempt = i === 0;
			if (isFirstAttempt || i % 10 === 0) {
				logger.info(`Waiting for database... (attempt ${i + 1}/${maxRetries})`);
			}
			await sleep(retryDelay);
		}
	}
}

async function runMigrations() {
	logger.info("Migrating database...");
	let retries = 10;
	while (retries > 0) {
		try {
			logger.info(`Running migrations (retries left: ${retries})`);
			const db = getDb();
			// Real, tested-in-review finding: this was missing `await` : with
			// Postgres (real network I/O, unlike bun:sqlite's local-file
			// migrator which apparently never surfaced this), a rejected
			// migrate() became an *unhandled* promise rejection outside this
			// try/catch, which crashes the whole process instead of being
			// caught and retried below.
			await migrate(db, {
				migrationsFolder,
			});
			logger.info("Database migrated successfully.");
			return;
		} catch (error) {
			logger.error(
				`Migration error, Retrying... (${retries} attempts left)`,
				error,
			);
			// This is the last retry, exit the process
			if (retries === 1) {
				logger.error("Could not migrate the database. Exiting.");
				logger.error(error);
				process.exit(1);
			}
			// Reset the database connection before retrying
			await resetDb();
			retries -= 1;
			await sleep(3000);
		}
	}
}

export const init = async () => {
	await waitForDatabase();
	await runMigrations();
	await seedBuiltinTemplates();

	// Merge DB-backed instance settings over the env defaults before the
	// server starts accepting requests : see $lib/config.ts. rebuildAuth()
	// reconstructs the better-auth singleton so OAuth providers configured
	// in the DB (rather than env) are present from the very first request,
	// not just after a settings-page save.
	const settings = await InstanceSettingsDTO.get();
	applyInstanceSettings(settings.toConfigOverride());
	rebuildAuth();

	CronService.startCronScheduler();
	CronService.startBackupScheduler();
	CronService.startAutoscaleScheduler();
};

/** Paths under the auth basePath that are handled by SvelteKit, not better-auth */
const customAuthPaths = new Set(["/api/v1/auth/providers"]);

/**
 * better-auth's real email/password sign-up endpoint (confirmed against
 * node_modules/better-auth/dist/api/routes/sign-up.mjs : `/sign-up/email`
 * relative to the basePath). Blocked directly here, not just hidden in the
 * UI, once any account exists : every account after the first is created
 * by an admin from the Users page (direct-create or email invite), never
 * through public self-service sign-up again.
 */
const SIGN_UP_PATH = "/api/v1/auth/sign-up/email";

const authHandler: Handle = async ({ event, resolve }) => {
	if (
		event.request.method === "POST" &&
		event.url.pathname === SIGN_UP_PATH &&
		(await AdminService.hasAnyUser())
	) {
		return new Response(
			JSON.stringify({
				message: "Sign-up is closed : an admin account already exists.",
			}),
			{ headers: { "content-type": "application/json" }, status: 403 },
		);
	}

	// A misconfigured OAuth provider (bad discovery URL, unreachable IdP :
	// now editable at any time via /settings, not just at deploy time via
	// env vars) makes better-auth's genericOAuth plugin throw while building
	// its auth context, which getSession() triggers on *every* request. Left
	// unguarded that's a full lockout : every page 500s, including /settings
	// itself, so there'd be no way back in to fix the bad provider. Degrade
	// to "no session" instead so the rest of the app (and /settings, to fix
	// the provider) stays reachable.
	const session = await auth.api
		.getSession({ headers: event.request.headers })
		.catch((error) => {
			logger.error("auth.getSession() failed : treating as signed out", error);
			return null;
		});

	if (session) {
		// Make session and user available on server
		event.locals.session = session.session;
		event.locals.user = session.user;
	} else {
		// Fallback: try API key authentication
		// Accepts either `x-api-key: <key>` or `Authorization: Bearer <key>`
		const authHeader = event.request.headers.get("authorization");
		const rawKey =
			event.request.headers.get("x-api-key") ??
			(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

		if (rawKey) {
			const result = await auth.api
				.verifyApiKey({ body: { key: rawKey } })
				.catch(() => null);

			if (!(result?.valid && result.key)) {
				logger.warn("Invalid API key authentication attempt", {
					key: rawKey,
				});

				return new Response(JSON.stringify({ error: "Unauthorized" }), {
					status: 401,
				});
			}

			// Look the owning user up directly by the key's referenceId rather
			// than going through getSession's API-key session-mocking (that
			// path is gated behind enableSessionForAPIKeys, which better-auth's
			// own docs warn against enabling in production : see api-key
			// plugin's types.d.ts).
			const [apiKeyUser] = await appDb
				.select()
				.from(userTable)
				.where(eq(userTable.id, result.key.referenceId))
				.limit(1);

			if (apiKeyUser) {
				event.locals.user = apiKeyUser;
			}
		}
	}

	// Declared in app.d.ts for exactly this : populated here so every route
	// can check `locals.isAdmin` instead of re-deriving it from `role`.
	event.locals.isAdmin = event.locals.user?.role === "admin";

	// Skip better-auth handler for custom SvelteKit-managed auth routes
	if (customAuthPaths.has(event.url.pathname)) {
		return resolve(event);
	}

	return svelteKitHandler({ auth, building, event, resolve });
};

const generalHandler: Handle = async ({ event, resolve }) => {
	const isUpload =
		event.request.method === "POST" &&
		event.url.pathname.includes("/storage/objects/item/");

	if (event.url.pathname.startsWith("/.well-known/")) {
		return await resolve(event);
	}
	// Ignore errors for favicon.ico
	if (event.url.pathname === "/favicon.ico") {
		return await resolve(event);
	}

	if (isUpload) {
		logger.debug("HOOKS_GENERAL", "About to resolve for upload", {
			bodyUsed: event.request.bodyUsed,
		});
	}

	const res = await resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === "content-length" || name === "content-type";
		},
	});

	if (isUpload) {
		logger.debug("HOOKS_GENERAL", "resolve complete for upload", {
			bodyUsed: event.request.bodyUsed,
			status: res.status,
		});
	}

	const isAsset =
		!event.url.pathname.endsWith("/") && event.url.pathname.includes(".");
	if (res.status >= 400 && !isAsset && res.status !== 404) {
		logger.error(
			`Error on ${event.request.method} ${event.url.pathname} - ${res.status}`,
		);
	} else {
		logger.info(
			`${event.request.method} ${event.url.pathname} - ${res.status}`,
		);
	}
	return res;
};

export const handle = sequence(generalHandler, authHandler);
