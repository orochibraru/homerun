import type { ClientFactory } from "./client";
import type { paths } from "./generated/openapi-types";
import { Output } from "./output";

type Client = ReturnType<typeof ClientFactory.makeClient>;

type ImageScan =
	paths["/services/{serviceId}/scans/latest"]["get"]["responses"][200]["content"]["application/json"];

type SeverityCounts = ImageScan["counts"];

type JobStatusBody =
	paths["/jobs/{jobId}"]["get"]["responses"][200]["content"]["application/json"];

export const FAIL_ON_LEVELS = ["critical", "high", "medium", "low"] as const;

export type FailOnLevel = (typeof FAIL_ON_LEVELS)[number];

export interface ScanArgs {
	failOn?: FailOnLevel;
	json: boolean;
	pollMs?: number;
	timeoutMs?: number;
	wait: boolean;
}

const DEFAULT_POLL_MS = 2000;
const DEFAULT_SCAN_TIMEOUT_MS = 30 * 60 * 1000;
const FINISHED_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export function findingsAtOrAbove(
	counts: SeverityCounts,
	level: FailOnLevel,
): number {
	const ranked = FAIL_ON_LEVELS.slice(0, FAIL_ON_LEVELS.indexOf(level) + 1);
	return ranked.reduce((total, severity) => total + counts[severity], 0);
}

function countsLine(counts: SeverityCounts): string {
	return `${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.unknown} unknown`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ListArgs {
	json: boolean;
	page?: number;
	perPage?: number;
	search?: string;
}

function listQuery(args: ListArgs): Record<string, string> {
	const query: Record<string, string> = {};
	if (args.page !== undefined) {
		query.page = String(args.page);
	}
	if (args.perPage !== undefined) {
		query.perPage = String(args.perPage);
	}
	if (args.search) {
		query.q = args.search;
	}
	return query;
}

/** Every command takes the already-built `Client` as an argument rather than owning one itself : this class holds no client of its own, it's grouped for consistency with every other cli/ module, not because it carries state. */
class CliCommands {
	async servicesList(client: Client, args: ListArgs): Promise<void> {
		const { data: services, response } = await this.#unwrapWithResponse(
			client.GET("/services", { params: { query: listQuery(args) } }),
		);
		if (args.json) {
			Output.printJson(services);
			return;
		}
		Output.printTable(
			(services as Record<string, unknown>[]).map((s) => ({
				id: s.id,
				image: `${s.image}:${s.tag}`,
				name: s.name,
				slug: s.slug,
				status: s.currentStatus,
			})),
			["id", "name", "slug", "status", "image"],
		);
		Output.printPageFooter(response, (services as unknown[]).length);
	}

	async serviceGet(client: Client, id: string): Promise<void> {
		const svc = await this.#unwrap(
			client.GET("/services/{serviceId}", {
				params: { path: { serviceId: id } },
			}),
		);
		Output.printJson(svc);
	}

	async serviceAction(
		client: Client,
		action: "deploy" | "start" | "stop" | "restart",
		id: string,
	): Promise<void> {
		const path = `/services/{serviceId}/${action}` as const;
		const result = await this.#unwrap(
			// biome-ignore lint/suspicious/noExplicitAny: the four action paths share an identical {params:{path:{serviceId}}} shape but openapi-fetch's generated overloads don't unify across a template-literal path union.
			(client.POST as any)(path, { params: { path: { serviceId: id } } }),
		);
		Output.printJson(result);
	}

	async scansList(
		client: Client,
		serviceId: string,
		args: ListArgs,
	): Promise<void> {
		const { data: scans, response } = await this.#unwrapWithResponse(
			client.GET("/services/{serviceId}/scans", {
				params: { path: { serviceId }, query: listQuery(args) },
			}),
		);
		if (args.json) {
			Output.printJson(scans);
			return;
		}
		Output.printTable(
			scans.map((scan) => ({
				critical: scan.counts.critical,
				high: scan.counts.high,
				id: scan.id,
				image: scan.imageRef,
				low: scan.counts.low,
				medium: scan.counts.medium,
				scannedAt: scan.scannedAt,
				status: scan.status,
			})),
			[
				"id",
				"scannedAt",
				"status",
				"critical",
				"high",
				"medium",
				"low",
				"image",
			],
		);
		Output.printPageFooter(response, scans.length);
	}

	async scanGet(
		client: Client,
		serviceId: string,
		scanId: string,
		json: boolean,
	): Promise<ImageScan> {
		const scan = await this.#fetchScan(client, serviceId, scanId);
		this.#printScan(scan, json);
		return scan;
	}

	async serviceScan(
		client: Client,
		serviceId: string,
		args: ScanArgs,
	): Promise<void> {
		const jobId = await this.#queueScan(client, serviceId, args.wait);
		if (!args.wait) {
			Output.printJson({ jobId, status: "queued" });
			return;
		}
		const job = await this.#waitForJob(
			client,
			jobId,
			args.pollMs ?? DEFAULT_POLL_MS,
			args.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS,
		);
		if (job.status !== "succeeded") {
			Output.fail(`Scan ${job.status}: ${job.error ?? "no reason given"}`);
		}
		const scan = await this.scanGet(client, serviceId, "latest", args.json);
		if (!args.failOn) {
			return;
		}
		const found = findingsAtOrAbove(scan.counts, args.failOn);
		if (found > 0) {
			Output.fail(
				`${found} ${found === 1 ? "finding" : "findings"} at or above ${args.failOn.toUpperCase()} (--fail-on ${args.failOn}).`,
			);
		}
	}

	async #fetchScan(
		client: Client,
		serviceId: string,
		scanId: string,
	): Promise<ImageScan> {
		if (scanId === "latest") {
			return await this.#unwrap(
				client.GET("/services/{serviceId}/scans/latest", {
					params: { path: { serviceId } },
				}),
			);
		}
		return await this.#unwrap(
			client.GET("/services/{serviceId}/scans/{scanId}", {
				params: { path: { scanId, serviceId } },
			}),
		);
	}

	#printScan(scan: ImageScan, json: boolean): void {
		if (json) {
			Output.printJson(scan);
			return;
		}
		console.log(`Scan ${scan.id} (${scan.status}, ${scan.scannedAt})`);
		console.log(`Image:    ${scan.imageRef}`);
		if (scan.digest) {
			console.log(`Digest:   ${scan.digest}`);
		}
		console.log(`Findings: ${countsLine(scan.counts)}`);
		if (scan.error) {
			console.log(`Error:    ${scan.error}`);
		}
		console.log("");
		Output.printTable(
			scan.findings.map((finding) => ({
				fixed: finding.fixedVersion ?? "",
				id: finding.id,
				installed: finding.installedVersion,
				package: finding.pkg,
				severity: finding.severity,
				title: finding.title ?? "",
			})),
			["severity", "id", "package", "installed", "fixed", "title"],
		);
		if (scan.totalFindings > scan.findings.length) {
			console.log(
				`\nShowing ${scan.findings.length} of ${scan.totalFindings} findings, most severe first.`,
			);
		}
	}

	async #queueScan(
		client: Client,
		serviceId: string,
		wait: boolean,
	): Promise<string> {
		const { data, error, response } = await client.POST(
			"/services/{serviceId}/scans",
			{ params: { path: { serviceId } } },
		);
		if (data) {
			return data.jobId;
		}
		if (wait && response.status === 409 && error && "jobId" in error) {
			return error.jobId;
		}
		return Output.fail(
			`${response.status} ${response.statusText}: ${JSON.stringify(error ?? {})}`,
		);
	}

	async #waitForJob(
		client: Client,
		jobId: string,
		pollMs: number,
		timeoutMs: number,
	): Promise<JobStatusBody> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			// biome-ignore lint/performance/noAwaitInLoops: polling one job's status is sequential by definition
			const job = await this.#unwrap(
				client.GET("/jobs/{jobId}", { params: { path: { jobId } } }),
			);
			if (FINISHED_JOB_STATUSES.has(job.status)) {
				return job;
			}
			if (Date.now() >= deadline) {
				return Output.fail(
					`Timed out waiting for scan job ${jobId} (still ${job.status}).`,
				);
			}
			await sleep(pollMs);
		}
	}

	async stacksList(client: Client, args: ListArgs): Promise<void> {
		const { data: stacks, response } = await this.#unwrapWithResponse(
			client.GET("/stacks", { params: { query: listQuery(args) } }),
		);
		if (args.json) {
			Output.printJson(stacks);
			return;
		}
		Output.printTable(
			(stacks as Record<string, unknown>[]).map((p) => ({
				id: p.id,
				name: p.name,
				slug: p.slug,
			})),
			["id", "name", "slug"],
		);
		Output.printPageFooter(response, (stacks as unknown[]).length);
	}

	async templatesList(client: Client, args: ListArgs): Promise<void> {
		const { data: templates, response } = await this.#unwrapWithResponse(
			client.GET("/templates", { params: { query: listQuery(args) } }),
		);
		if (args.json) {
			Output.printJson(templates);
			return;
		}
		Output.printTable(
			(templates as Record<string, unknown>[]).map((t) => ({
				id: t.id,
				image: `${t.image}:${t.tag}`,
				name: t.name,
			})),
			["id", "name", "image"],
		);
		Output.printPageFooter(response, (templates as unknown[]).length);
	}

	async #unwrapWithResponse<T>(
		promise: Promise<{ data?: T; error?: unknown; response: Response }>,
	): Promise<{ data: T; response: Response }> {
		const { data, error, response } = await promise;
		if (error !== undefined || !response.ok) {
			Output.fail(
				`${response.status} ${response.statusText}: ${JSON.stringify(error ?? {})}`,
			);
		}
		return { data: data as T, response };
	}

	async #unwrap<T>(
		promise: Promise<{ data?: T; error?: unknown; response: Response }>,
	): Promise<T> {
		const { data, error, response } = await promise;
		if (error !== undefined || !response.ok) {
			Output.fail(
				`${response.status} ${response.statusText}: ${JSON.stringify(error ?? {})}`,
			);
		}
		return data as T;
	}
}

export const Commands = new CliCommands();
