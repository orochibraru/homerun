export const USER_ROLES = ["admin", "developer", "viewer"] as const;

export type Role = (typeof USER_ROLES)[number];

export const READ_ONLY_ROLE: Role = "viewer";

export const ROLE_OPTIONS: { label: string; value: Role }[] = [
	{ label: "Developer", value: "developer" },
	{ label: "Read-only", value: "viewer" },
	{ label: "Admin", value: "admin" },
];

export const API_KEY_SCOPES = ["full", "read"] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_SCOPE_OPTIONS: {
	description: string;
	label: string;
	value: ApiKeyScope;
}[] = [
	{
		description: "Everything your account can do.",
		label: "Full access",
		value: "full",
	},
	{
		description: "GET requests only, every write is refused with a 403.",
		label: "Read-only",
		value: "read",
	},
];

export const READ_ONLY_MESSAGE =
	"This account or API key is read-only: it can view everything but can't change anything.";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const SELF_SERVICE_PREFIXES = [
	"/api/v1/auth/",
	"/api/v1/auth-token",
	"/profile",
	"/cli-auth",
	"/security-setup",
	"/auth/",
	"/app-auth",
	"/api/v1/mcp",
];

const SELF_SERVICE_REMOTE_COMMANDS = new Set([
	"deleteAllNotifications",
	"deleteNotification",
	"markAllNotificationsRead",
	"markNotificationRead",
]);

const REMOTE_PREFIX = "/_app/remote/";

/**
 * A role in the shape better-auth's admin plugin endpoints are typed with. The
 * plugin types roles as its own defaults ("user" | "admin") because this app
 * doesn't register an access-control role map, but it stores whatever string
 * it's given, so every role here is passed through unchanged.
 */
export function asAuthRole(role: Role): "admin" | "user" {
	return role as "admin" | "user";
}

/** Whether `role` is a role this app knows about. */
export function isUserRole(role: unknown): role is Role {
	return typeof role === "string" && USER_ROLES.includes(role as Role);
}

/** The display label for a stored role, falling back to Developer for an unset one. */
export function roleLabel(role: string | null | undefined): string {
	return (
		ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Developer"
	);
}

/** The scope an API key was created with, read from its better-auth metadata. A key with no scope recorded is a full-access key. */
export function apiKeyScopeOf(metadata: unknown): ApiKeyScope {
	const parsed =
		typeof metadata === "string" ? safeParseJson(metadata) : metadata;
	if (
		parsed &&
		typeof parsed === "object" &&
		(parsed as { scope?: unknown }).scope === "read"
	) {
		return "read";
	}
	return "full";
}

function safeParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/** Whether a request is limited to reading: the user holds the read-only role, or it authenticated with a read-scoped API key. */
export function isReadOnly(
	role: string | null | undefined,
	apiKeyScope: ApiKeyScope | null,
): boolean {
	return role === READ_ONLY_ROLE || apiKeyScope === "read";
}

/**
 * Whether a read-only caller may still make this request: every safe method,
 * plus the self-service surfaces that only touch the caller's own account
 * (sign-out, passkeys and 2FA, profile preferences and API keys, CLI login,
 * the notification bell). Everything else that writes is refused.
 */
export function readOnlyMayRequest(method: string, pathname: string): boolean {
	if (SAFE_METHODS.has(method.toUpperCase())) {
		return true;
	}
	if (pathname.startsWith(REMOTE_PREFIX)) {
		const name = pathname.slice(REMOTE_PREFIX.length).split("/")[1] ?? "";
		return SELF_SERVICE_REMOTE_COMMANDS.has(name);
	}
	return SELF_SERVICE_PREFIXES.some(
		(prefix) =>
			pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix),
	);
}
