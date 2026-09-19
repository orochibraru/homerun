export const SCAN_SEVERITIES = [
	"CRITICAL",
	"HIGH",
	"MEDIUM",
	"LOW",
	"UNKNOWN",
] as const;

export type ScanSeverity = (typeof SCAN_SEVERITIES)[number];

export type BlockSeverity = Exclude<ScanSeverity, "UNKNOWN">;

export interface ScanBlockPolicy {
	fixableOnly: boolean;
	severity: BlockSeverity | null;
}

export interface ScanPolicyVerdict {
	blocked: boolean;
	blocking: SeverityCounts;
	reason: string | null;
}

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
	fixableCounts: SeverityCounts;
	findings: ImageScanFinding[];
	totalFindings: number;
}

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
	{
		description:
			"A deploy fails before its workload starts if the image has any MEDIUM, HIGH or CRITICAL finding.",
		label: "Medium and above",
		value: "MEDIUM",
	},
	{
		description:
			"A deploy fails before its workload starts if the image has any LOW, MEDIUM, HIGH or CRITICAL finding. Findings of unknown severity never block.",
		label: "Low and above",
		value: "LOW",
	},
];

/** A fresh per-severity vulnerability count with every severity at zero. */
export function emptyCounts(): SeverityCounts {
	return { critical: 0, high: 0, low: 0, medium: 0, unknown: 0 };
}

function countKey(severity: ScanSeverity): keyof SeverityCounts {
	return severity.toLowerCase() as keyof SeverityCounts;
}

const BLOCKING_ORDER: readonly BlockSeverity[] = [
	"CRITICAL",
	"HIGH",
	"MEDIUM",
	"LOW",
];

/** The severities a policy at `severity` blocks on, most severe first. */
export function severitiesAtOrAbove(severity: BlockSeverity): BlockSeverity[] {
	return BLOCKING_ORDER.slice(0, BLOCKING_ORDER.indexOf(severity) + 1);
}

/** Describes a block policy in a few words, e.g. "HIGH or above, fixable only". */
export function describeBlockPolicy(policy: ScanBlockPolicy): string {
	if (!policy.severity) {
		return "off";
	}
	const threshold =
		policy.severity === "CRITICAL" ? "CRITICAL" : `${policy.severity} or above`;
	return policy.fixableOnly ? `${threshold}, fixable only` : threshold;
}

/**
 * Evaluates one scan's counts against the deploy block policy. With
 * `fixableOnly`, only findings that have a fixed version count; a scan
 * recorded before fixable counts existed (`fixableCounts` null) falls back to
 * every finding.
 *
 * @returns Whether a deploy of this image is blocked, the counted findings at
 * or above the threshold (zero below it), and the user-facing reason when
 * blocked.
 */
export function evaluateScanPolicy(
	scan: { counts: SeverityCounts; fixableCounts: SeverityCounts | null },
	policy: ScanBlockPolicy,
): ScanPolicyVerdict {
	const blocking = emptyCounts();
	if (!policy.severity) {
		return { blocked: false, blocking, reason: null };
	}
	const source =
		policy.fixableOnly && scan.fixableCounts ? scan.fixableCounts : scan.counts;
	const severities = severitiesAtOrAbove(policy.severity);
	for (const severity of severities) {
		blocking[countKey(severity)] = source[countKey(severity)];
	}
	const total = severities.reduce(
		(sum, severity) => sum + blocking[countKey(severity)],
		0,
	);
	if (total === 0) {
		return { blocked: false, blocking, reason: null };
	}
	const found = severities
		.filter((severity) => blocking[countKey(severity)] > 0)
		.map(
			(severity) => `${blocking[countKey(severity)]} ${severity.toLowerCase()}`,
		)
		.join(", ");
	const noun = total === 1 ? "vulnerability" : "vulnerabilities";
	const kind = policy.fixableOnly ? `fixable ${noun}` : noun;
	return {
		blocked: true,
		blocking,
		reason: `Blocked by the image scan policy (block at ${describeBlockPolicy(policy)}): ${total} ${kind} at or above the threshold (${found}). Full scan: ${countsLine(scan.counts)}. Fix the image, or change the policy under Settings → Docker.`,
	};
}

/** Formats severity counts as a one-line summary for logs and notifications. */
export function countsLine(counts: SeverityCounts): string {
	return `${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.unknown} unknown`;
}

/** Whether a value is a valid scan blocking severity (`CRITICAL`, `HIGH`, `MEDIUM` or `LOW`). */
export function isBlockSeverity(value: unknown): value is BlockSeverity {
	return (BLOCKING_ORDER as readonly unknown[]).includes(value);
}
