export const SEARCH_MIN_LENGTH = 2;

export const SEARCH_MAX_LENGTH = 100;

export const SEARCH_GROUP_LIMIT = 5;

export type SearchResultKind =
	| "authProvider"
	| "buildCacheRegistry"
	| "cronJob"
	| "gitProvider"
	| "notificationChannel"
	| "stack"
	| "remoteHost"
	| "s3Destination"
	| "service"
	| "statusPage"
	| "storageVolume"
	| "template"
	| "user";

export interface SearchResult {
	detail: string | null;
	href: string;
	id: string;
	kind: SearchResultKind;
	label: string;
}

export interface SearchGroup {
	heading: string;
	kind: SearchResultKind;
	results: SearchResult[];
}

export const SEARCH_GROUP_HEADINGS: Record<SearchResultKind, string> = {
	authProvider: "Auth providers",
	buildCacheRegistry: "Build cache registries",
	cronJob: "Cron jobs",
	gitProvider: "Git providers",
	notificationChannel: "Notification channels",
	stack: "Stacks",
	remoteHost: "Remote hosts",
	s3Destination: "S3 destinations",
	service: "Services",
	statusPage: "Status pages",
	storageVolume: "Storage volumes",
	template: "Templates",
	user: "Users",
};

export interface SearchPage {
	adminOnly: boolean;
	href: string;
	keywords: string[];
	label: string;
	section: string;
}

export const SEARCH_PAGES: SearchPage[] = [
	{
		adminOnly: false,
		href: "/",
		keywords: ["dashboard", "home"],
		label: "Overview",
		section: "Workspace",
	},
	{
		adminOnly: false,
		href: "/services",
		keywords: ["containers", "apps"],
		label: "Services",
		section: "Workspace",
	},
	{
		adminOnly: false,
		href: "/services/new",
		keywords: ["deploy", "create", "add"],
		label: "Deploy a service",
		section: "Services",
	},
	{
		adminOnly: false,
		href: "/services/import",
		keywords: ["compose", "docker-compose", "yaml"],
		label: "Import compose",
		section: "Services",
	},
	{
		adminOnly: false,
		href: "/stacks",
		keywords: ["groups"],
		label: "Stacks",
		section: "Workspace",
	},
	{
		adminOnly: false,
		href: "/stacks/new",
		keywords: ["create", "add", "stack"],
		label: "New stack",
		section: "Stacks",
	},
	{
		adminOnly: false,
		href: "/templates",
		keywords: ["gallery", "catalog"],
		label: "Templates",
		section: "Workspace",
	},
	{
		adminOnly: false,
		href: "/templates/new",
		keywords: ["create", "add"],
		label: "New template",
		section: "Templates",
	},
	{
		adminOnly: false,
		href: "/cron-jobs",
		keywords: ["scheduled", "tasks"],
		label: "Cron Jobs",
		section: "Workspace",
	},
	{
		adminOnly: false,
		href: "/cron-jobs/new",
		keywords: ["create", "add"],
		label: "New cron job",
		section: "Cron Jobs",
	},
	{
		adminOnly: false,
		href: "/status-pages",
		keywords: ["uptime", "health"],
		label: "Status Pages",
		section: "Workspace",
	},
	{
		adminOnly: false,
		href: "/status-pages/new",
		keywords: ["create", "add"],
		label: "New status page",
		section: "Status Pages",
	},
	{
		adminOnly: false,
		href: "/storage",
		keywords: ["volumes", "disks", "mounts"],
		label: "Storage",
		section: "Infrastructure",
	},
	{
		adminOnly: false,
		href: "/storage/new",
		keywords: ["create", "add", "volume"],
		label: "New volume",
		section: "Storage",
	},
	{
		adminOnly: false,
		href: "/backups",
		keywords: ["restore", "runs"],
		label: "Backups",
		section: "Infrastructure",
	},
	{
		adminOnly: false,
		href: "/s3-destinations",
		keywords: ["bucket", "minio"],
		label: "S3 Destinations",
		section: "Infrastructure",
	},
	{
		adminOnly: false,
		href: "/s3-destinations/new",
		keywords: ["create", "add", "bucket"],
		label: "New S3 destination",
		section: "S3 Destinations",
	},
	{
		adminOnly: false,
		href: "/remote-hosts",
		keywords: ["agents", "servers", "build servers"],
		label: "Remote Hosts",
		section: "Infrastructure",
	},
	{
		adminOnly: false,
		href: "/remote-hosts/new",
		keywords: ["create", "add", "agent"],
		label: "New remote host",
		section: "Remote Hosts",
	},
	{
		adminOnly: false,
		href: "/scheduling",
		keywords: ["jobs", "queue", "cron"],
		label: "Scheduling",
		section: "Infrastructure",
	},
	{
		adminOnly: false,
		href: "/git-providers",
		keywords: ["github", "gitlab", "gitea", "bitbucket"],
		label: "Git Providers",
		section: "Integrations",
	},
	{
		adminOnly: false,
		href: "/build-cache-registries",
		keywords: ["registry", "cache"],
		label: "Build Cache",
		section: "Integrations",
	},
	{
		adminOnly: false,
		href: "/build-cache-registries/new",
		keywords: ["create", "add", "registry"],
		label: "New build cache registry",
		section: "Build Cache",
	},
	{
		adminOnly: false,
		href: "/notification-channels",
		keywords: ["webhook", "discord", "slack", "telegram", "email", "alerts"],
		label: "Notification Channels",
		section: "Integrations",
	},
	{
		adminOnly: false,
		href: "/api-docs",
		keywords: ["openapi", "rest", "reference"],
		label: "API Docs",
		section: "Integrations",
	},
	{
		adminOnly: false,
		href: "/profile",
		keywords: ["account", "name", "email"],
		label: "Personal Information",
		section: "Profile",
	},
	{
		adminOnly: false,
		href: "/profile/security",
		keywords: ["password", "account"],
		label: "Security",
		section: "Profile",
	},
	{
		adminOnly: false,
		href: "/profile/sessions",
		keywords: ["devices", "sign out"],
		label: "Sessions",
		section: "Profile",
	},
	{
		adminOnly: false,
		href: "/profile/clients",
		keywords: ["cli", "tokens", "api keys"],
		label: "Authorized Clients",
		section: "Profile",
	},
	{
		adminOnly: false,
		href: "/profile/appearance",
		keywords: ["theme", "dark mode", "accent", "colors"],
		label: "Appearance",
		section: "Profile",
	},
	{
		adminOnly: false,
		href: "/profile/notifications",
		keywords: ["alerts", "events"],
		label: "Notification Preferences",
		section: "Profile",
	},
	{
		adminOnly: true,
		href: "/users",
		keywords: ["members", "invites", "roles"],
		label: "Users",
		section: "Administration",
	},
	{
		adminOnly: true,
		href: "/authentication",
		keywords: ["oauth", "oidc", "sso", "sign-in", "login wall"],
		label: "Authentication",
		section: "Administration",
	},
	{
		adminOnly: true,
		href: "/authentication/new",
		keywords: ["oauth", "oidc", "provider", "add"],
		label: "New auth provider",
		section: "Authentication",
	},
	{
		adminOnly: true,
		href: "/settings",
		keywords: ["general", "base domain", "instance"],
		label: "Settings",
		section: "Administration",
	},
	{
		adminOnly: true,
		href: "/settings/docker",
		keywords: ["socket", "network", "swarm"],
		label: "Docker Settings",
		section: "Settings",
	},
	{
		adminOnly: true,
		href: "/settings/networking",
		keywords: ["traefik", "tls", "acme", "cache"],
		label: "Networking Settings",
		section: "Settings",
	},
	{
		adminOnly: true,
		href: "/dns",
		keywords: ["dns", "cloudflare", "pangolin", "domains", "tunnel"],
		label: "DNS",
		section: "Integrations",
	},
	{
		adminOnly: true,
		href: "/settings/email",
		keywords: ["smtp", "mail"],
		label: "Email Settings",
		section: "Settings",
	},
	{
		adminOnly: true,
		href: "/settings/migrate",
		keywords: ["dokploy", "coolify", "migration", "import"],
		label: "Migrate from Dokploy or Coolify",
		section: "Settings",
	},
	{
		adminOnly: true,
		href: "/system-logs",
		keywords: ["logs"],
		label: "System Logs",
		section: "Administration",
	},
	{
		adminOnly: true,
		href: "/registry",
		keywords: ["registry", "images", "tokens", "push", "pull", "mirror"],
		label: "Registry",
		section: "Administration",
	},
	{
		adminOnly: true,
		href: "/docker-cleanup",
		keywords: ["prune", "images", "disk"],
		label: "Docker Cleanup",
		section: "Administration",
	},
];

/** Trims and lowercases a search query for case-insensitive matching. */
export function normalizeSearch(value: string): string {
	return value.trim().toLowerCase();
}

/**
 * Whether any of the given fields contains the query as a case-insensitive
 * substring. A blank query matches nothing.
 */
export function matchesSearch(
	q: string,
	fields: Array<string | null | undefined>,
): boolean {
	const term = normalizeSearch(q);
	if (!term) {
		return false;
	}
	return fields.some((field) => field?.toLowerCase().includes(term));
}

/**
 * Filters the static page list for global search, hiding admin-only pages from
 * non-admins. A blank query returns every visible page.
 */
export function filterPages(
	pages: SearchPage[],
	q: string,
	isAdmin: boolean,
): SearchPage[] {
	const visible = pages.filter((p) => isAdmin || !p.adminOnly);
	if (!normalizeSearch(q)) {
		return visible;
	}
	return visible.filter((p) =>
		matchesSearch(q, [p.label, p.section, p.href, ...p.keywords]),
	);
}

/**
 * Groups search results by kind, in order of each kind's first appearance, with
 * the display heading for each group.
 */
export function groupResults(results: SearchResult[]): SearchGroup[] {
	const groups: SearchGroup[] = [];
	for (const result of results) {
		let group = groups.find((g) => g.kind === result.kind);
		if (!group) {
			group = {
				heading: SEARCH_GROUP_HEADINGS[result.kind],
				kind: result.kind,
				results: [],
			};
			groups.push(group);
		}
		group.results.push(result);
	}
	return groups;
}
