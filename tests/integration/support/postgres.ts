import process from "node:process";
import { SQL } from "bun";
import { ciTimeout, stepLog } from "./ci";
import { TEST_DB_NAME } from "./config";
import { startPostgresContainer } from "./postgres-container";

export interface TestPostgres {
	containerName?: string;
	databaseUrl: string;
	stop: () => Promise<void>;
}

export function servicePostgresUrl(): string | undefined {
	const url = process.env.HOMERUN_TEST_POSTGRES_URL?.trim();
	return url ? url : undefined;
}

export async function startTestPostgres(): Promise<TestPostgres> {
	const serviceUrl = servicePostgresUrl();
	if (!serviceUrl) {
		return startPostgresContainer();
	}
	return connectServicePostgres(serviceUrl);
}

async function connectServicePostgres(
	serviceUrl: string,
): Promise<TestPostgres> {
	stepLog("Using the provided service Postgres (HOMERUN_TEST_POSTGRES_URL)...");
	await waitForServicePostgres(serviceUrl);

	const database = uniqueDatabaseName();
	stepLog(`Creating a fresh per-run database ${database}...`);
	await withAdminConnection(serviceUrl, async (sql) => {
		await sql.unsafe(`create database "${database}"`);
	});

	return {
		databaseUrl: withDatabase(serviceUrl, database),
		stop: async () => {
			await withAdminConnection(serviceUrl, async (sql) => {
				await sql.unsafe(`drop database if exists "${database}" with (force)`);
			});
		},
	};
}

function uniqueDatabaseName(): string {
	const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	const name = `${TEST_DB_NAME}_${suffix}`;
	if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
		throw new Error(`Refusing to use unsafe database name '${name}'`);
	}
	return name;
}

function withDatabase(serviceUrl: string, database: string): string {
	const url = new URL(serviceUrl);
	url.pathname = `/${database}`;
	return url.toString();
}

async function withAdminConnection(
	serviceUrl: string,
	fn: (sql: SQL) => Promise<void>,
): Promise<void> {
	const sql = new SQL(serviceUrl);
	try {
		await fn(sql);
	} finally {
		await sql.close();
	}
}

async function waitForServicePostgres(
	serviceUrl: string,
	timeoutMs = ciTimeout(15_000, 60_000),
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		const sql = new SQL(serviceUrl);
		try {
			await sql`select 1`;
			await sql.close();
			return;
		} catch (err) {
			lastError = err;
			await sql.close().catch(() => {});
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	throw new Error(
		`Service Postgres at ${redact(serviceUrl)} never became ready within ${timeoutMs}ms: ${lastError}`,
	);
}

function redact(serviceUrl: string): string {
	try {
		const url = new URL(serviceUrl);
		url.password = "";
		return url.toString();
	} catch {
		return "<unparseable HOMERUN_TEST_POSTGRES_URL>";
	}
}
