export const UNGROUPED_LABEL = "Ungrouped";

import {
	Activity,
	Ban,
	BookOpen,
	Box,
	ChartBar,
	CheckCircle,
	Clock,
	Database,
	Ghost,
	HardDrive,
	LayoutDashboard,
	Loader2,
	MessagesSquare,
	Network,
	Newspaper,
	NotebookPen,
	Play,
	ShieldCheck,
	Sparkles,
	Terminal,
	Wallet,
	Workflow,
	XCircle,
} from "@lucide/svelte";
import type { ContainerStatus, JobStatus, JobType } from "$lib/types";

export const JOB_STATUS_CONFIG: Record<
	JobStatus,
	{ label: string; class: string; icon: typeof CheckCircle }
> = {
	cancelled: {
		class:
			"border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-400",
		icon: Ban,
		label: "Cancelled",
	},
	failed: {
		class: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400",
		icon: XCircle,
		label: "Failed",
	},
	queued: {
		class:
			"border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-400",
		icon: Clock,
		label: "Queued",
	},
	running: {
		class: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400",
		icon: Loader2,
		label: "Running",
	},
	succeeded: {
		class:
			"border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
		icon: CheckCircle,
		label: "Succeeded",
	},
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
	backup: "Backup",
	backup_restore: "Restore",
	cron_job: "Cron job",
	deploy: "Deploy",
	docker_cleanup: "Cleanup",
	image_scan: "Image scan",
	notification_delivery: "Notification",
};

export const SERVICE_STATUS_CONFIG: Record<
	ContainerStatus,
	{ label: string; class: string; icon: typeof CheckCircle }
> = {
	failed: {
		class: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400",
		icon: XCircle,
		label: "Failed",
	},
	missing: {
		class:
			"border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400",
		icon: Ghost,
		label: "Missing",
	},
	pending: {
		class:
			"border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-400",
		icon: Clock,
		label: "Pending",
	},
	pulling: {
		class: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400",
		icon: Loader2,
		label: "Pulling",
	},
	running: {
		class:
			"border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
		icon: CheckCircle,
		label: "Running",
	},
	starting: {
		class:
			"border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
		icon: Loader2,
		label: "Starting",
	},
	stopped: {
		class:
			"border-orange-500/25 bg-orange-500/10 text-orange-600 dark:text-orange-400",
		icon: XCircle,
		label: "Stopped",
	},
};

export const TEMPLATE_CATEGORY_ICONS: Record<string, typeof Database> = {
	ai: Sparkles,
	analytics: ChartBar,
	automation: Workflow,
	cache: Database,
	cms: Newspaper,
	communication: MessagesSquare,
	dashboard: LayoutDashboard,
	database: Database,
	development: Terminal,
	finance: Wallet,
	media: Play,
	monitoring: Activity,
	network: Network,
	productivity: NotebookPen,
	reading: BookOpen,
	security: ShieldCheck,
	storage: HardDrive,
};

export const TEMPLATE_CATEGORY_COLORS: Record<
	string,
	{ bg: string; text: string }
> = {
	ai: {
		bg: "bg-purple-500/10",
		text: "text-purple-600 dark:text-purple-400",
	},
	analytics: {
		bg: "bg-fuchsia-500/10",
		text: "text-fuchsia-600 dark:text-fuchsia-400",
	},
	automation: {
		bg: "bg-violet-500/10",
		text: "text-violet-600 dark:text-violet-400",
	},
	cache: { bg: "bg-teal-500/10", text: "text-teal-600 dark:text-teal-400" },
	cms: { bg: "bg-pink-500/10", text: "text-pink-600 dark:text-pink-400" },
	communication: {
		bg: "bg-blue-500/10",
		text: "text-blue-600 dark:text-blue-400",
	},
	dashboard: {
		bg: "bg-amber-500/10",
		text: "text-amber-600 dark:text-amber-400",
	},
	database: {
		bg: "bg-emerald-500/10",
		text: "text-emerald-600 dark:text-emerald-400",
	},
	development: {
		bg: "bg-slate-500/10",
		text: "text-slate-600 dark:text-slate-400",
	},
	finance: { bg: "bg-lime-500/10", text: "text-lime-600 dark:text-lime-400" },
	media: { bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400" },
	monitoring: {
		bg: "bg-cyan-500/10",
		text: "text-cyan-600 dark:text-cyan-400",
	},
	network: { bg: "bg-sky-500/10", text: "text-sky-600 dark:text-sky-400" },
	productivity: {
		bg: "bg-indigo-500/10",
		text: "text-indigo-600 dark:text-indigo-400",
	},
	reading: {
		bg: "bg-yellow-500/10",
		text: "text-yellow-600 dark:text-yellow-400",
	},
	security: { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400" },
	storage: {
		bg: "bg-orange-500/10",
		text: "text-orange-600 dark:text-orange-400",
	},
};

/**
 * The Lucide icon for a template category, or a generic box for unknown or
 * missing categories.
 */
export function templateCategoryIcon(category: string | null): typeof Database {
	return (category && TEMPLATE_CATEGORY_ICONS[category]) || Box;
}

/**
 * The background and text colour classes for a template category's badge, or
 * the accent colours for unknown or missing categories.
 */
export function templateCategoryColor(category: string | null): {
	bg: string;
	text: string;
} {
	return (
		(category && TEMPLATE_CATEGORY_COLORS[category]) || {
			bg: "bg-accent-light",
			text: "text-accent",
		}
	);
}

/**
 * Marks a volume choice that exists on the Docker daemon but isn't a Homerun
 * storage volume yet : the service Volumes tab offers both in one picker and
 * registers the host one on submit.
 */
export const HOST_VOLUME_PREFIX = "docker:";
