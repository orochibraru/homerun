import { mayVisit, type Permissions } from "#lib/permissions.js";

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
	s3Destination: "Backup destinations",
	service: "Services",
	statusPage: "Status pages",
	storageVolume: "Storage volumes",
	template: "Templates",
	user: "Users",
};

export interface SearchPage {
	href: string;
	keywords: string[];
	label: string;
	section: string;
}

export const SEARCH_PAGES: SearchPage[] = [
	{
		href: "/",
		keywords: ["dashboard", "home"],
		label: "Overview",
		section: "Workspace",
	},
	{
		href: "/services",
		keywords: ["containers", "apps"],
		label: "Services",
		section: "Workspace",
	},
	{
		href: "/services/new",
		keywords: ["deploy", "create", "add"],
		label: "Deploy a service",
		section: "Services",
	},
	{
		href: "/services/import",
		keywords: ["compose", "docker-compose", "yaml"],
		label: "Import compose",
		section: "Services",
	},
	{
		href: "/stacks",
		keywords: ["groups"],
		label: "Stacks",
		section: "Workspace",
	},
	{
		href: "/stacks/new",
		keywords: ["create", "add", "stack"],
		label: "New stack",
		section: "Stacks",
	},
	{
		href: "/templates",
		keywords: ["gallery", "catalog"],
		label: "Templates",
		section: "Workspace",
	},
	{
		href: "/templates/new",
		keywords: ["create", "add"],
		label: "New template",
		section: "Templates",
	},
	{
		href: "/redirects",
		keywords: ["forward", "301", "308", "domain", "url"],
		label: "Redirects",
		section: "Infrastructure",
	},
	{
		href: "/redirects/new",
		keywords: ["create", "add"],
		label: "New redirect",
		section: "Redirects",
	},
	{
		href: "/cron-jobs",
		keywords: ["scheduled", "tasks"],
		label: "Cron Jobs",
		section: "Workspace",
	},
	{
		href: "/cron-jobs/new",
		keywords: ["create", "add"],
		label: "New cron job",
		section: "Cron Jobs",
	},
	{
		href: "/status-pages",
		keywords: ["uptime", "health"],
		label: "Status Pages",
		section: "Workspace",
	},
	{
		href: "/status-pages/new",
		keywords: ["create", "add"],
		label: "New status page",
		section: "Status Pages",
	},
	{
		href: "/storage",
		keywords: ["volumes", "disks", "mounts", "storage"],
		label: "Volumes",
		section: "Storage",
	},
	{
		href: "/storage/new",
		keywords: ["create", "add", "volume"],
		label: "New volume",
		section: "Volumes",
	},
	{
		href: "/backups",
		keywords: ["restore", "runs"],
		label: "Backups",
		section: "Storage",
	},
	{
		href: "/s3-destinations",
		keywords: ["bucket", "minio", "s3", "sftp", "smb", "webdav", "nas"],
		label: "Backup Destinations",
		section: "Storage",
	},
	{
		href: "/object-storage",
		keywords: ["s3", "buckets", "garage", "minio", "r2", "object"],
		label: "Object Storage",
		section: "Storage",
	},
	{
		href: "/object-storage/state",
		keywords: ["terraform", "pulumi", "tfstate", "iac", "state", "lock"],
		label: "Terraform State",
		section: "Object Storage",
	},
	{
		href: "/iac",
		keywords: ["terraform", "pulumi", "iac", "hcl", "generate", "import"],
		label: "Infrastructure as Code",
		section: "Integrations",
	},
	{
		href: "/iac/drift",
		keywords: ["terraform", "drift", "state", "compare"],
		label: "Drift",
		section: "Infrastructure as Code",
	},
	{
		href: "/s3-destinations/new",
		keywords: ["create", "add", "bucket", "s3", "sftp", "smb", "webdav"],
		label: "New backup destination",
		section: "Backup Destinations",
	},
	{
		href: "/remote-hosts",
		keywords: ["agents", "servers", "build servers"],
		label: "Remote Hosts",
		section: "Infrastructure",
	},
	{
		href: "/remote-hosts/new",
		keywords: ["create", "add", "agent"],
		label: "New remote host",
		section: "Remote Hosts",
	},
	{
		href: "/scheduling",
		keywords: ["jobs", "queue", "cron"],
		label: "Scheduling",
		section: "Infrastructure",
	},
	{
		href: "/git-providers",
		keywords: ["github", "gitlab", "gitea", "bitbucket"],
		label: "Git Providers",
		section: "Integrations",
	},
	{
		href: "/build-cache-registries",
		keywords: ["registry", "cache"],
		label: "Build Cache",
		section: "Integrations",
	},
	{
		href: "/build-cache-registries/new",
		keywords: ["create", "add", "registry"],
		label: "New build cache registry",
		section: "Build Cache",
	},
	{
		href: "/notification-channels",
		keywords: ["webhook", "discord", "slack", "telegram", "email", "alerts"],
		label: "Notification Channels",
		section: "Integrations",
	},
	{
		href: "/api-docs",
		keywords: ["openapi", "rest", "reference"],
		label: "API Docs",
		section: "Integrations",
	},
	{
		href: "/profile",
		keywords: ["account", "name", "email"],
		label: "Personal Information",
		section: "Profile",
	},
	{
		href: "/profile/security",
		keywords: ["password", "account"],
		label: "Security",
		section: "Profile",
	},
	{
		href: "/profile/sessions",
		keywords: ["devices", "sign out"],
		label: "Sessions",
		section: "Profile",
	},
	{
		href: "/profile/clients",
		keywords: ["cli", "tokens", "api keys"],
		label: "Authorized Clients",
		section: "Profile",
	},
	{
		href: "/profile/appearance",
		keywords: ["theme", "dark mode", "accent", "colors"],
		label: "Appearance",
		section: "Profile",
	},
	{
		href: "/profile/notifications",
		keywords: ["alerts", "events"],
		label: "Notification Preferences",
		section: "Profile",
	},
	{
		href: "/users",
		keywords: ["members", "invites", "roles"],
		label: "Users",
		section: "Administration",
	},
	{
		href: "/authentication",
		keywords: ["oauth", "oidc", "sso", "sign-in", "login wall"],
		label: "Authentication",
		section: "Administration",
	},
	{
		href: "/authentication/new",
		keywords: ["oauth", "oidc", "provider", "add"],
		label: "New auth provider",
		section: "Authentication",
	},
	{
		href: "/settings",
		keywords: ["general", "base domain", "instance"],
		label: "Settings",
		section: "Administration",
	},
	{
		href: "/settings/docker",
		keywords: ["socket", "network", "swarm"],
		label: "Docker Settings",
		section: "Settings",
	},
	{
		href: "/settings/networking",
		keywords: ["traefik", "tls", "acme", "cache"],
		label: "Networking Settings",
		section: "Settings",
	},
	{
		href: "/dns",
		keywords: ["dns", "cloudflare", "pangolin", "domains", "tunnel"],
		label: "DNS",
		section: "Integrations",
	},
	{
		href: "/idp",
		keywords: ["oidc", "openid", "sso", "sign in with homerun", "oauth apps"],
		label: "IDP",
		section: "Integrations",
	},
	{
		href: "/settings/email",
		keywords: ["smtp", "mail"],
		label: "Email Settings",
		section: "Settings",
	},
	{
		href: "/settings/migrate",
		keywords: ["dokploy", "coolify", "migration", "import"],
		label: "Migrate from Dokploy or Coolify",
		section: "Settings",
	},
	{
		href: "/system-logs",
		keywords: ["logs"],
		label: "System Logs",
		section: "Administration",
	},
	{
		href: "/registry",
		keywords: ["registry", "images", "tokens", "push", "pull", "mirror"],
		label: "Registry",
		section: "Administration",
	},
	{
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
 * Filters the static page list for global search, hiding pages `permissions`
 * can't open. A blank query returns every visible page.
 */
export function filterPages(
	pages: SearchPage[],
	q: string,
	permissions: Permissions,
): SearchPage[] {
	const visible = pages.filter((p) => mayVisit(permissions, p.href));
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
