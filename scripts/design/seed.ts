import type { PGlite } from "@electric-sql/pglite";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/pglite";

import {
	account,
	appLog,
	deployment,
	instanceSettings,
	service,
	stack,
	statSample,
	trafficSample,
	user,
	userPreferences,
} from "../../src/lib/server/db/schema";

/** The account design mode signs in with. */
export const DESIGN_ACCOUNT = {
	email: "design@homerun.local",
	name: "Ada Designer",
	password: "design-mode-password",
};

interface DesignService {
	env?: Record<string, string>;
	image: string;
	load: number;
	name: string;
	slug: string;
	stack: string;
	stopped?: boolean;
	tag: string;
}

const STACKS = [
	{ name: "Apps", slug: "apps" },
	{ name: "Sites", slug: "sites" },
	{ name: "Infra", slug: "infra" },
];

const SERVICES: DesignService[] = [
	{
		env: {
			CACHE_URL: "redis://cache:6379",
			DRAGONFLY_URL: "redis://dragonfly:6379",
		},
		image: "ghcr.io/acme/drive",
		load: 1,
		name: "Drive",
		slug: "drive",
		stack: "apps",
		tag: "2.4.1",
	},
	{
		env: { REDIS_URL: "redis://cache:6379" },
		image: "ghcr.io/acme/api-server",
		load: 0.45,
		name: "Server",
		slug: "server",
		stack: "apps",
		tag: "1.9.0",
	},
	{
		env: { API_URL: "http://server:8080" },
		image: "ghcr.io/acme/web",
		load: 0.35,
		name: "Web",
		slug: "web",
		stack: "apps",
		tag: "0.31.2",
	},
	{
		env: { MCP_URL: "http://mcp:8080" },
		image: "ghcr.io/acme/assistant",
		load: 0.15,
		name: "Assistant",
		slug: "assistant",
		stack: "apps",
		tag: "main",
	},
	{
		image: "docker.gitea.com/gitea-mcp-server",
		load: 0.08,
		name: "MCP",
		slug: "mcp",
		stack: "apps",
		tag: "1.11.0",
	},
	{
		image: "ghcr.io/acme/counter",
		load: 0.12,
		name: "Counter",
		slug: "counter",
		stack: "apps",
		tag: "1.2.0",
	},
	{
		image: "ghcr.io/acme/blog",
		load: 0.28,
		name: "Blog",
		slug: "blog",
		stack: "sites",
		tag: "main",
	},
	{
		image: "ghcr.io/acme/shop",
		load: 0.22,
		name: "Shop",
		slug: "shop",
		stack: "sites",
		tag: "main",
	},
	{
		env: { DATABASE_URL: "postgres://umami:umami@umami-db:5432/umami" },
		image: "ghcr.io/umami-software/umami",
		load: 0.18,
		name: "Analytics",
		slug: "umami",
		stack: "sites",
		tag: "postgresql-latest",
	},
	{
		image: "postgres",
		load: 0,
		name: "Analytics DB",
		slug: "umami-db",
		stack: "sites",
		tag: "18.6-alpine",
	},
	{
		image: "redis",
		load: 0,
		name: "Cache",
		slug: "cache",
		stack: "infra",
		tag: "7.4-alpine",
	},
	{
		image: "docker.dragonflydb.io/dragonflydb/dragonfly",
		load: 0,
		name: "Dragonfly",
		slug: "dragonfly",
		stack: "infra",
		tag: "v1.24",
	},
	{
		image: "corentinth/it-tools",
		load: 0.05,
		name: "IT Tools",
		slug: "it-tools",
		stack: "infra",
		stopped: true,
		tag: "latest",
	},
];

const HOUR = 3_600_000;
const SAMPLE_MS = 5 * 60_000;

/** A repeatable pseudo-random sequence, so every design run seeds the same instance. */
function random(seed: number): () => number {
	let x = seed;
	return () => {
		x = (x * 9301 + 49_297) % 233_280;
		return x / 233_280;
	};
}

/** How busy a service is at `at`: quiet at night, a peak early afternoon. */
function diurnal(at: number): number {
	const hour = new Date(at).getHours() + new Date(at).getMinutes() / 60;
	return 0.25 + 0.75 * Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2));
}

/**
 * Fills the design-mode database: the admin account (`DESIGN_ACCOUNT`),
 * three stacks of services wired together
 * through env vars, two days of traffic and resource samples, a deploy
 * history with a failure and a rollback, a few logged errors, a failed
 * update trial, and the onboarding marked done so the dashboard opens.
 */
export async function seedDesignData(pglite: PGlite): Promise<void> {
	const db = drizzle(pglite);
	const now = Date.now();
	const rnd = random(7);
	const userId = crypto.randomUUID();

	await db.insert(user).values({
		createdAt: new Date(now - 60 * 24 * HOUR),
		email: DESIGN_ACCOUNT.email,
		emailVerified: true,
		id: userId,
		name: DESIGN_ACCOUNT.name,
		role: "admin",
		updatedAt: new Date(now),
	});
	await db.insert(account).values({
		accountId: userId,
		createdAt: new Date(now - 60 * 24 * HOUR),
		id: crypto.randomUUID(),
		password: await hashPassword(DESIGN_ACCOUNT.password),
		providerId: "credential",
		updatedAt: new Date(now),
		userId,
	});
	await db
		.insert(instanceSettings)
		.values({
			createdAt: new Date(now - 60 * 24 * HOUR),
			id: "default",
			onboardingCompletedAt: new Date(now - 30 * 24 * HOUR),
		})
		.onConflictDoUpdate({
			set: { onboardingCompletedAt: new Date(now - 30 * 24 * HOUR) },
			target: instanceSettings.id,
		});
	await db
		.insert(userPreferences)
		.values({
			createdAt: new Date(now),
			surfaceStyle: "lanes",
			updatedAt: new Date(now),
			userId,
		})
		.onConflictDoUpdate({
			set: { surfaceStyle: "lanes" },
			target: userPreferences.userId,
		});

	const stackIds = new Map<string, string>();
	for (const entry of STACKS) {
		const id = crypto.randomUUID();
		stackIds.set(entry.slug, id);
		await db.insert(stack).values({
			createdAt: new Date(now - 40 * 24 * HOUR),
			id,
			name: entry.name,
			slug: entry.slug,
			updatedAt: new Date(now - 2 * HOUR),
			userId,
		});
	}

	for (const [index, entry] of SERVICES.entries()) {
		const id = crypto.randomUUID();
		const status = entry.stopped ? "stopped" : "running";
		await db.insert(service).values({
			containerId: `design-${entry.stopped ? "stopped-" : ""}${entry.slug}`,
			containerPort: 8080,
			createdAt: new Date(now - (30 - index) * 24 * HOUR),
			currentStatus: status,
			desiredState: status,
			envVars: entry.env ?? {},
			id,
			image: entry.image,
			name: entry.name,
			slug: entry.slug,
			stackId: stackIds.get(entry.stack) ?? null,
			tag: entry.tag,
			updateCheck:
				entry.slug === "mcp"
					? {
							available: {
								digest: null,
								foundAt: new Date(now - 18 * HOUR).toISOString(),
								tag: "1.12.0",
							},
							checkedAt: new Date(now - HOUR).toISOString(),
							error: null,
							notifiedKey: null,
							trial: {
								at: new Date(now - 17 * HOUR).toISOString(),
								attempts: 4,
								message: "Health check failed 4 times",
								status: "failed",
								tag: "1.12.0",
							},
						}
					: null,
			updatedAt: new Date(now - HOUR),
			userId,
		});

		const deploys =
			entry.slug === "drive"
				? [2, 2.1, 2.2, 52]
				: [4 + index * 5, 30 + index * 3];
		for (const [n, hoursAgo] of deploys.entries()) {
			const at = now - hoursAgo * HOUR;
			const failed = entry.slug === "web" && n === 1;
			await db.insert(deployment).values({
				createdAt: new Date(at),
				errorMessage: failed
					? "Health check failed: connection refused on :8080"
					: null,
				finishedAt: new Date(at + (60 + Math.round(rnd() * 240)) * 1000),
				health: failed ? "unhealthy" : "healthy",
				id: crypto.randomUUID(),
				imageRef: `${entry.image}:${entry.tag}`,
				serviceId: id,
				startedAt: new Date(at),
				status: failed ? "failed" : "running",
				trigger: n === 0 ? "manual" : "push",
				userId,
			});
		}

		const traffic = [];
		const stats = [];
		for (let at = now - 48 * HOUR; at <= now; at += SAMPLE_MS) {
			if (entry.load > 0 && !entry.stopped) {
				const requests = Math.round(
					entry.load * 900 * diurnal(at) * (0.7 + rnd() * 0.6),
				);
				const errorBurst =
					entry.slug === "web" && Math.abs(now - 9 * HOUR - at) < HOUR;
				traffic.push({
					bytesIn: requests * 900,
					bytesOut: requests * 14_000,
					createdAt: new Date(at),
					durationMs: requests * (entry.slug === "web" ? 230 : 8 + rnd() * 30),
					id: crypto.randomUUID(),
					requests,
					serviceId: id,
					status4xx: Math.round(requests * 0.01),
					status5xx: errorBurst
						? Math.round(requests * 0.4)
						: Math.round(requests * 0.002),
				});
			}
			if (!entry.stopped && at % (SAMPLE_MS * 3) < SAMPLE_MS) {
				stats.push({
					cpuPercent: 0.3 + entry.load * 4 * diurnal(at) + rnd(),
					createdAt: new Date(at),
					id: crypto.randomUUID(),
					memLimitMb: 1024,
					memUsedMb: 60 + entry.load * 300 + rnd() * 20,
					serviceId: id,
				});
			}
		}
		for (let i = 0; i < traffic.length; i += 200) {
			await db.insert(trafficSample).values(traffic.slice(i, i + 200));
		}
		for (let i = 0; i < stats.length; i += 200) {
			await db.insert(statSample).values(stats.slice(i, i + 200));
		}
	}

	const hostStats = [];
	for (let at = now - 48 * HOUR; at <= now; at += SAMPLE_MS) {
		hostStats.push({
			cpuPercent: 8 + 25 * diurnal(at) + rnd() * 6,
			createdAt: new Date(at),
			diskUsedGb: 439,
			id: crypto.randomUUID(),
			memUsedMb: 4800 + rnd() * 600,
		});
	}
	for (let i = 0; i < hostStats.length; i += 200) {
		await db.insert(statSample).values(hostStats.slice(i, i + 200));
	}

	await db.insert(appLog).values([
		{
			createdAt: new Date(now - 2 * HOUR),
			id: crypto.randomUUID(),
			level: "warn",
			message: "Stats tick failed: context deadline exceeded",
			scope: "Stats",
		},
		{
			createdAt: new Date(now - 9 * HOUR),
			id: crypto.randomUUID(),
			level: "error",
			message: "Health check failed: connection refused on :8080",
			scope: "Deploy",
		},
	]);
}
