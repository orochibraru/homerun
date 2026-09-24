import type { ScanSeverity } from "$lib/image-scan";

export const SEVERITY_CLASS: Record<ScanSeverity, string> = {
	CRITICAL: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400",
	HIGH: "border-orange-500/25 bg-orange-500/10 text-orange-600 dark:text-orange-400",
	LOW: "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400",
	MEDIUM:
		"border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
	UNKNOWN: "border-border bg-surface-2 text-text-muted",
};
