export const UNGROUPED_LABEL = "Ungrouped";

import {
	Activity,
	Ban,
	Box,
	ChartBar,
	CheckCircle,
	Clock,
	Database,
	Ghost,
	LayoutDashboard,
	Loader2,
	Network,
	NotebookPen,
	Play,
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
	deploy: "Deploy",
	docker_cleanup: "Cleanup",
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
	analytics: ChartBar,
	automation: Workflow,
	cache: Database,
	dashboard: LayoutDashboard,
	database: Database,
	development: Terminal,
	finance: Wallet,
	media: Play,
	monitoring: Activity,
	network: Network,
	productivity: NotebookPen,
};

export const TEMPLATE_CATEGORY_COLORS: Record<
	string,
	{ bg: string; text: string }
> = {
	analytics: {
		bg: "bg-fuchsia-500/10",
		text: "text-fuchsia-600 dark:text-fuchsia-400",
	},
	automation: {
		bg: "bg-violet-500/10",
		text: "text-violet-600 dark:text-violet-400",
	},
	cache: { bg: "bg-teal-500/10", text: "text-teal-600 dark:text-teal-400" },
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
};

export function templateCategoryIcon(category: string | null): typeof Database {
	return (category && TEMPLATE_CATEGORY_ICONS[category]) || Box;
}

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

export const GRADIENTS = [
	"from-violet-500 to-purple-700",
	"from-blue-500 to-indigo-700",
	"from-rose-500 to-red-700",
	"from-amber-500 to-orange-700",
	"from-emerald-500 to-green-700",
	"from-sky-500 to-cyan-700",
	"from-pink-500 to-fuchsia-700",
	"from-teal-500 to-cyan-700",
] as const;

export const GRADIENTS_DARKER = [
	"from-violet-600 via-purple-700 to-indigo-900",
	"from-blue-600 via-indigo-700 to-violet-900",
	"from-rose-600 via-pink-700 to-purple-900",
	"from-emerald-600 via-teal-700 to-cyan-900",
	"from-amber-600 via-orange-700 to-red-900",
	"from-cyan-600 via-blue-700 to-indigo-900",
	"from-fuchsia-600 via-violet-700 to-purple-900",
	"from-red-600 via-rose-700 to-pink-900",
] as const;
