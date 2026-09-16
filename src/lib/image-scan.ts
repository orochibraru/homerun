export const SCAN_SEVERITIES = [
	"CRITICAL",
	"HIGH",
	"MEDIUM",
	"LOW",
	"UNKNOWN",
] as const;

export type ScanSeverity = (typeof SCAN_SEVERITIES)[number];

export type BlockSeverity = "CRITICAL" | "HIGH";

export type ImageScanStatus = "ok" | "failed" | "skipped";

export interface SeverityCounts {
	critical: number;
	high: number;
	low: number;
	medium: number;
	unknown: number;
}

export interface ImageScanFinding {
	fixedVersion: string | null;
	id: string;
	installedVersion: string;
	pkg: string;
	severity: ScanSeverity;
	title: string | null;
}

export interface TrivySummary {
	counts: SeverityCounts;
	findings: ImageScanFinding[];
	totalFindings: number;
}

export const MAX_STORED_FINDINGS = 200;

export const BLOCK_SEVERITY_OPTIONS: ReadonlyArray<{
	description: string;
	label: string;
	value: BlockSeverity | "off";
}> = [
	{
		description:
			"Findings are recorded and shown, never enforced. Deploys always go ahead.",
		label: "Off",
		value: "off",
	},
	{
		description:
			"A deploy fails before its workload starts if the image has any CRITICAL finding.",
		label: "Critical",
		value: "CRITICAL",
	},
	{
		description:
			"A deploy fails before its workload starts if the image has any HIGH or CRITICAL finding.",
		label: "High and above",
		value: "HIGH",
	},
];

const SEVERITY_RANK: Record<ScanSeverity, number> = {
	CRITICAL: 0,
	HIGH: 1,
	LOW: 3,
	MEDIUM: 2,
	UNKNOWN: 4,
};

/** A fresh per-severity vulnerability count with every severity at zero. */
export function emptyCounts(): SeverityCounts {
	return { critical: 0, high: 0, low: 0, medium: 0, unknown: 0 };
}

function normalizeSeverity(value: unknown): ScanSeverity {
	const upper = typeof value === "string" ? value.toUpperCase() : "";
	return (SCAN_SEVERITIES as readonly string[]).includes(upper)
		? (upper as ScanSeverity)
		: "UNKNOWN";
}

function countKey(severity: ScanSeverity): keyof SeverityCounts {
	return severity.toLowerCase() as keyof SeverityCounts;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asText(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Extracts the vulnerability findings from one Trivy result entry, skipping
 * malformed entries and normalising unknown severities.
 */
function findingsOf(result: unknown): ImageScanFinding[] {
	const vulnerabilities = asRecord(result)?.Vulnerabilities;
	if (!Array.isArray(vulnerabilities)) {
		return [];
	}
	return vulnerabilities.flatMap((raw) => {
		const entry = asRecord(raw);
		const id = asText(entry?.VulnerabilityID);
		if (!(entry && id)) {
			return [];
		}
		return [
			{
				fixedVersion: asText(entry.FixedVersion),
				id,
				installedVersion: asText(entry.InstalledVersion) ?? "",
				pkg: asText(entry.PkgName) ?? asText(entry.PkgID) ?? "",
				severity: normalizeSeverity(entry.Severity),
				title: asText(entry.Title),
			},
		];
	});
}

/**
 * Summarises a Trivy JSON report into per-severity counts and a capped list of
 * findings, de-duplicated by vulnerability, package and version and sorted by
 * severity with fixable findings first.
 *
 * @param limit Maximum number of findings kept; `totalFindings` still counts all.
 * @throws When the output isn't a JSON object.
 */
export function summarizeTrivyReport(
	raw: string,
	limit = MAX_STORED_FINDINGS,
): TrivySummary {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Trivy didn't return a JSON report.");
	}
	const report = asRecord(parsed);
	if (!report) {
		throw new Error("Trivy didn't return a JSON report.");
	}
	const results = Array.isArray(report.Results) ? report.Results : [];

	const seen = new Set<string>();
	const unique: ImageScanFinding[] = [];
	for (const finding of results.flatMap(findingsOf)) {
		const key = `${finding.id}|${finding.pkg}|${finding.installedVersion}`;
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(finding);
		}
	}

	const counts = emptyCounts();
	for (const finding of unique) {
		counts[countKey(finding.severity)] += 1;
	}

	const sorted = unique.toSorted(
		(a, b) =>
			SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
			Number(a.fixedVersion === null) - Number(b.fixedVersion === null) ||
			a.id.localeCompare(b.id),
	);

	return {
		counts,
		findings: sorted.slice(0, limit),
		totalFindings: unique.length,
	};
}

/**
 * Checks scan counts against the deploy blocking policy.
 *
 * @returns The user-facing reason the deploy is blocked, or null when no policy
 * is set or no vulnerability at or above the policy's severity was found.
 */
export function blockReason(
	counts: SeverityCounts,
	policy: BlockSeverity | null,
): string | null {
	if (!policy) {
		return null;
	}
	const blocking =
		policy === "CRITICAL" ? counts.critical : counts.critical + counts.high;
	if (blocking === 0) {
		return null;
	}
	const scope = policy === "CRITICAL" ? "CRITICAL" : "HIGH or CRITICAL";
	return `Blocked by the image scan policy: ${blocking} ${scope} ${blocking === 1 ? "vulnerability" : "vulnerabilities"} found. Fix the image, or change the policy under Settings → Docker.`;
}

/** Formats severity counts as a one-line summary for logs and notifications. */
export function countsLine(counts: SeverityCounts): string {
	return `${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.unknown} unknown`;
}

/** Whether a value is a valid scan blocking policy (`CRITICAL` or `HIGH`). */
export function isBlockSeverity(value: unknown): value is BlockSeverity {
	return value === "CRITICAL" || value === "HIGH";
}
