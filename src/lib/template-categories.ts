export const TEMPLATE_CATEGORIES = [
	{ label: "AI", value: "ai" },
	{ label: "Analytics", value: "analytics" },
	{ label: "Automation", value: "automation" },
	{ label: "Cache", value: "cache" },
	{ label: "CMS", value: "cms" },
	{ label: "Communication", value: "communication" },
	{ label: "Dashboard", value: "dashboard" },
	{ label: "Database", value: "database" },
	{ label: "Development", value: "development" },
	{ label: "Finance", value: "finance" },
	{ label: "Media", value: "media" },
	{ label: "Monitoring", value: "monitoring" },
	{ label: "Network", value: "network" },
	{ label: "Productivity", value: "productivity" },
	{ label: "Reading", value: "reading" },
	{ label: "Security", value: "security" },
	{ label: "Storage", value: "storage" },
	{ label: "Other", value: "other" },
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]["value"];

/** The display label of a template category, or the raw value for one this list doesn't know. */
export function templateCategoryLabel(category: string): string {
	return (
		TEMPLATE_CATEGORIES.find((c) => c.value === category)?.label ?? category
	);
}
