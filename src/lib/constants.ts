import { CheckCircle, Clock, XCircle } from "@lucide/svelte";

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

export const STATUS_COLORS: Record<string, string> = {
	planned: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
	installed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
	removed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export const STATUS_CONFIG: Record<string, { label: string; class: string; icon: typeof CheckCircle }> = {
	installed: { label: "Installed", class: STATUS_COLORS.installed, icon: CheckCircle },
	planned: { label: "Planned", class: STATUS_COLORS.planned, icon: Clock },
	removed: { label: "Removed", class: STATUS_COLORS.removed, icon: XCircle },
};

export const CATEGORY_LABELS: Record<string, string> = {
	engine: "Engine",
	turbo: "Turbo / Boost",
	exhaust: "Exhaust",
	suspension: "Suspension",
	wheels: "Wheels & Tires",
	brakes: "Brakes",
	exterior: "Exterior",
	interior: "Interior",
	electronics: "Electronics",
	audio: "Audio",
	fuel: "Fuel System",
	transmission: "Transmission",
	drivetrain: "Drivetrain",
	other: "Other",
};

export const MOD_CATEGORIES = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
	value,
	label,
}));

export const CATEGORY_COLORS: Record<string, string> = {
	engine: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
	turbo: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
	exhaust: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
	suspension: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
	wheels: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
	brakes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
	exterior: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
	interior: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
	electronics: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
	audio: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
	fuel: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400",
	transmission: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
	drivetrain: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
	other: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export const CATEGORY_BAR_COLORS: Record<string, string> = {
	engine: "bg-violet-500",
	turbo: "bg-purple-500",
	exhaust: "bg-orange-500",
	suspension: "bg-blue-500",
	wheels: "bg-sky-500",
	brakes: "bg-red-500",
	exterior: "bg-amber-500",
	interior: "bg-pink-500",
	electronics: "bg-teal-500",
	audio: "bg-cyan-500",
	fuel: "bg-lime-500",
	transmission: "bg-indigo-500",
	drivetrain: "bg-slate-500",
	other: "bg-gray-500",
};
