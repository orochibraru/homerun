import { join } from "node:path";
import process, { cwd } from "node:process";
import type { Handle, RequestEvent } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { building } from "$app/environment";
import {
	applyInstanceSettings,
	config,
	setDetectedAuthCheckUrl,
} from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { GIT_WEBHOOK_PATH } from "$lib/git-webhooks";
import { Logger } from "$lib/logger";
import { OIDC_BASE_PATH } from "$lib/oidc-provider";
import { apiKeyScopeOf, isReadOnly } from "$lib/permissions";
import { isForbiddenCrossSiteForm } from "$lib/server/csrf";
import { db as appDb, getDb, resetDb } from "$lib/server/db";
import { user as userTable } from "$lib/server/db/schema";
import { seedBuiltinTemplates } from "$lib/server/db/seed";
import { readOnlyRejection } from "$lib/server/read-only";
import { AdminService } from "$lib/services/admin.service";
import { auth, rebuildAuth } from "$lib/services/auth";
import { CronService } from "$lib/services/cron.service";
import { DeploymentService } from "$lib/services/deploy.service";
import { syncDashboardDns } from "$lib/services/dns.service";
import { DockerService } from "$lib/services/docker.service";
import { OrchestrationService } from "$lib/services/orchestration.service";
import { JobWorker } from "$lib/services/queue/worker";

const logger = new Logger("Hooks");

const migrationsFolder = join(cwd(), "drizzle");

/**
 * A Postgres connection refused/timed out while a `load`/action reached the
 * DB : the common trigger is the app itself having started before Postgres
 * finished coming up (`docker compose up -d`, or a still-in-progress
 * migration retry loop, see `waitForDatabase`/`runMigrations` below, both
 * only gate this *server's* own boot, not a request that reaches it from a
 * separate, still-starting Postgres container in the same compose stack).
 * Distinguished so the error page says something actually actionable
 * ("still starting up, reload in a moment") instead of a raw driver
 * message like "connect ECONNREFUSED ...".
 */
function isDatabaseUnavailableError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	return (
		code === "ECONNREFUSED" ||
		code === "ETIMEDOUT" ||
		/ECONNREFUSED|ETIMEDOUT/.test(error.message)
	);
}

/** Same short random-id convention as hooks.client.ts's makeid(), so a server-side 500 is just as traceable in the logs as a client-side one. */
function makeErrorId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

/**
 * Logs an uncaught server error under a fresh error id and turns it into the
 * plain `App.Error` object the error page renders. 404s are skipped, and an
 * unreachable database gets a `DATABASE_UNAVAILABLE` code with a
 * reload-in-a-moment message instead of the driver's.
 */
export function handleError({ event, error, status }) {
	if (status === 404) {
		return;
	}
	const errorId = makeErrorId();
	logger.error(
		`Error on ${event.request.method} ${event.url.pathname} (errorId=${errorId})`,
		error,
	);

	// Real, tested-in-review bug this replaced : this used to `return new
	// Error(...)`, but this function's return value becomes `App.Error`
	// (app.d.ts), sent to the client as page data, and devalue (SvelteKit's
	// own load/error-payload serializer) can't stringify a real Error
	// instance, only a plain object. That crashed with a completely
	// unrelated-looking "Cannot stringify arbitrary non-POJOs" 500 instead
	// of the actual error, for *every* uncaught error in this app, not just
	// a DB-unavailable one, verified live.
	if (isDatabaseUnavailableError(error)) {
		return {
			code: "DATABASE_UNAVAILABLE",
			errorId,
			message:
				"The database isn't reachable yet, it may still be starting up. Wait a few seconds and reload.",
		};
	}

	return {
		errorId,
		message:
			error instanceof Error ? error.message : "An unknown error occurred.",
	};
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks boot until Postgres answers a trivial query, retrying up to 10 times 2
 * seconds apart with a fresh connection pool each time, and exits the process
 * once retries run out.
 */
async function waitForDatabase() {
	const maxRetries = 10;
	const retryDelay = 2000;

	for (let i = 0; i < maxRetries; i += 1) {
		try {
			// Reset connection before each attempt to avoid stale connections
			if (i > 0) {
				// biome-ignore lint/performance/noAwaitInLoops: retry backoff: each attempt must follow the previous one
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
				logger.error(
					`Could not reach Postgres after ${maxRetries} attempts. Check DATABASE_URL in .env, and for local dev start it with "docker compose up -d". Exiting.`,
				);
				logger.error(`Last error: ${error}`);
				process.exit(1);
			}
			logger.info(`Waiting for database... (attempt ${i + 1}/${maxRetries})`);
			await sleep(retryDelay);
		}
	}
}

/**
 * Applies pending Drizzle migrations from `drizzle/`, retrying up to 10 times 3
 * seconds apart with a fresh connection pool, and exits the process if they
 * still fail.
 */
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
			// biome-ignore lint/performance/noAwaitInLoops: retry loop: one migrate attempt at a time
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

/**
 * Server boot sequence, run once before the first request : waits for the
 * database, migrates and seeds built-in templates, applies DB-backed instance
 * settings (plus the auto-detected forward-auth URL when running in a
 * container), rebuilds auth, syncs the dashboard's Traefik router and DNS,
 * picks the orchestration mode for a brand new instance and queues the
 * redeploys `--migrate-to-rootful` asked for, re-asserts swarm mode on the
 * host (a `docker compose up` recreating Traefik drops its swarm provider
 * flags) when that's the orchestration mode, then
 * starts the job worker, rollout health watches and every scheduler.
 */
export const init = async () => {
	await waitForDatabase();
	await runMigrations();
	await seedBuiltinTemplates();

	// Merge DB-backed instance settings over the env defaults before the
	// server starts accepting requests : see $lib/config.ts. rebuildAuth()
	// reconstructs the better-auth singleton so OAuth providers configured
	// in the DB (rather than env) are present from the very first request,
	// not just after a settings-page save.
	const { created, settings } = await InstanceSettingsDTO.getOrCreate();
	applyInstanceSettings(settings.toConfigOverride());
	const self = await DockerService.selfContainer();
	if (self?.name && self.networkAddress) {
		setDetectedAuthCheckUrl(
			`http://${self.name}:${config.port}/api/v1/auth-check`,
		);
		applyInstanceSettings(settings.toConfigOverride());
	}
	rebuildAuth();
	await DockerService.syncDashboardRouter();
	void syncDashboardDns();
	await OrchestrationService.applyOnBoot(settings, created).catch((err) => {
		logger.warn("Couldn't apply the orchestration mode on boot", err);
	});
	if (settings.orchestrationMode === "swarm") {
		void DockerService.enableSwarmMode().catch((err) => {
			logger.warn("Couldn't re-assert swarm mode on this host", err);
		});
	}

	JobWorker.start();
	void DeploymentService.resumeHealthWatches();

	CronService.startCronScheduler();
	CronService.startBackupScheduler();
	CronService.startCronJobScheduler();
	CronService.startStatsSampler();
	CronService.startUptimeProbe();
	CronService.startMirrorGcScheduler();
	CronService.startGitPollScheduler();
};

/**
 * Paths under the auth basePath that are handled by SvelteKit, not
 * better-auth. Real, tested-live finding: `/api/v1/auth/cli/device` and
 * `/api/v1/auth/cli/token` (the CLI's `homerun login` device-code flow,
 * $lib/services/cli-auth.service.ts) were never added here, so every
 * request to either one was silently swallowed by better-auth's own
 * handler (any path starting with the auth basePath goes to
 * `auth.handler()` unless it's in this set, see svelteKitHandler's
 * `isAuthPath` in node_modules/better-auth/dist/integrations/svelte-kit.mjs)
 * and 404'd before ever reaching the real SvelteKit route files — verified
 * live, a real `homerun login` against a real running instance failed
 * immediately with "Couldn't start login: 404 Not Found" before this fix.
 */
const customAuthPaths = new Set([
	"/api/v1/auth/providers",
	"/api/v1/auth/cli/device",
	"/api/v1/auth/cli/token",
]);

/**
 * better-auth's real email/password sign-up endpoint (confirmed against
 * node_modules/better-auth/dist/api/routes/sign-up.mjs : `/sign-up/email`
 * relative to the basePath). Blocked directly here, not just hidden in the
 * UI, once any account exists : every account after the first is created
 * by an admin from the Users page (direct-create or email invite), never
 * through public self-service sign-up again.
 */
const SIGN_UP_PATH = "/api/v1/auth/sign-up/email";

/** Blocks public self-service sign-up once any account exists : the endpoint itself, so it can't be curled around. */
async function signUpClosedResponse(
	event: RequestEvent,
): Promise<Response | null> {
	const isSignUp =
		event.request.method === "POST" && event.url.pathname === SIGN_UP_PATH;
	if (!(isSignUp && (await AdminService.hasAnyUser()))) {
		return null;
	}
	return new Response(
		JSON.stringify({
			message: "Sign-up is closed : an admin account already exists.",
		}),
		{ headers: { "content-type": "application/json" }, status: 403 },
	);
}

/** The raw API key from `x-api-key` or `Authorization: Bearer`, or null when neither is present. */
function readApiKey(event: RequestEvent): string | null {
	const authHeader = event.request.headers.get("authorization");
	return (
		event.request.headers.get("x-api-key") ??
		(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null)
	);
}

/**
 * Whether `pathname` is one of the OAuth/OIDC provider endpoints apps call
 * with their own `Authorization: Bearer <access token>` (userinfo,
 * introspection, revocation) or read anonymously (JWKS, discovery). Those
 * tokens aren't Homerun API keys, so the API-key fallback must not 401 them.
 */
function isOidcProviderPath(pathname: string): boolean {
	return (
		pathname.startsWith(`${OIDC_BASE_PATH}/oauth2/`) ||
		pathname.startsWith(`${OIDC_BASE_PATH}/.well-known/`) ||
		pathname === `${OIDC_BASE_PATH}/jwks`
	);
}

/**
 * API-key fallback for a request with no cookie session : populates
 * `locals.user` on success, and returns a 401 response when a key was sent
 * but doesn't verify. Returns null when there's nothing to do.
 */
async function applyApiKeyAuth(event: RequestEvent): Promise<Response | null> {
	const rawKey = readApiKey(event);
	if (!rawKey) {
		return null;
	}

	const result = await auth.api
		.verifyApiKey({ body: { key: rawKey } })
		.catch(() => null);

	if (!(result?.valid && result.key)) {
		logger.warn("Invalid API key authentication attempt", { key: rawKey });
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
		event.locals.apiKeyScope = apiKeyScopeOf(result.key.metadata);
	}
	return null;
}

/**
 * Resolves the request's user from the better-auth session cookie, falling back
 * to an API key, and sets `locals.isAdmin`. Rejects closed sign-up and bad API
 * keys up front, and passes auth API paths to better-auth except the few
 * SvelteKit routes that live under its base path.
 */
const authHandler: Handle = async ({ event, resolve }) => {
	const signUpClosed = await signUpClosedResponse(event);
	if (signUpClosed) {
		return signUpClosed;
	}

	const session = await auth.api
		.getSession({ headers: event.request.headers })
		.catch((error) => {
			logger.debug("auth.getSession() failed : treating as signed out", error);
			return null;
		});

	if (session) {
		// Make session and user available on server
		event.locals.session = session.session;
		event.locals.user = session.user;
	} else if (!isOidcProviderPath(event.url.pathname)) {
		const rejected = await applyApiKeyAuth(event);
		if (rejected) {
			return rejected;
		}
	}

	// Declared in app.d.ts for exactly this : populated here so every route
	// can check `locals.isAdmin` instead of re-deriving it from `role`.
	event.locals.isAdmin = event.locals.user?.role === "admin";
	event.locals.apiKeyScope ??= null;
	event.locals.readOnly =
		!!event.locals.user &&
		isReadOnly(event.locals.user.role, event.locals.apiKeyScope);
	if (event.locals.readOnly) {
		const refused = readOnlyRejection(event.request, event.url.pathname);
		if (refused) {
			return refused;
		}
	}

	// Skip better-auth handler for custom SvelteKit-managed auth routes
	if (customAuthPaths.has(event.url.pathname)) {
		return resolve(event);
	}

	return svelteKitHandler({ auth, building, event, resolve });
};

/**
 * Resolves the request with only content-length and content-type exposed to
 * serialized fetches, then logs it : an error line for 4xx/5xx page responses
 * other than 404, an info line otherwise. Well-known paths and the favicon skip
 * logging.
 */
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

const OIDC_SERVER_TO_SERVER_PATHS = new Set(
	["token", "introspect", "revoke", "end-session"].map(
		(endpoint) => `${OIDC_BASE_PATH}/oauth2/${endpoint}`,
	),
);

/**
 * Refuses cross-site form posts, in place of SvelteKit's built-in check
 * (turned off in vite.config.ts), except on the OAuth endpoints apps call
 * from their own servers and on git push webhooks, which arrive with a form
 * body (depending on the provider) and no `Origin` header.
 */
const csrfHandler: Handle = async ({ event, resolve }) => {
	if (
		!building &&
		isForbiddenCrossSiteForm(
			event.request,
			event.url,
			(pathname) =>
				OIDC_SERVER_TO_SERVER_PATHS.has(pathname) ||
				pathname.startsWith(`${GIT_WEBHOOK_PATH}/`),
		)
	) {
		return new Response(
			`Cross-site ${event.request.method} form submissions are forbidden`,
			{ status: 403 },
		);
	}
	return await resolve(event);
};

export const handle = sequence(csrfHandler, generalHandler, authHandler);
