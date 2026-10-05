import { childSlug } from "#lib/slug.js";

export const DEPLOY_ENVIRONMENTS = ["production", "canary", "preview"] as const;

export const DEFAULT_TAG_PATTERN = "v*";

/**
 * The environment a service's deployments belong to: its release channel
 * canary, a pull request preview, else the service's own environment name
 * (an environment created on a service carries its name), `production` when
 * it has none.
 */
export function deployEnvironment(row: {
	channelCanary: boolean;
	environmentName: string | null;
	previewParentId: string | null;
}): string {
	if (row.channelCanary) {
		return "canary";
	}
	if (row.previewParentId && !row.environmentName) {
		return "preview";
	}
	return row.environmentName ?? "production";
}

export const ENVIRONMENT_NAME_PATTERN =
	/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** Why a custom environment name can't be used, null when it's fine (blank means production). */
export function environmentNameProblem(name: string): string | null {
	if (!name || name === "production") {
		return null;
	}
	if (name === "canary" || name === "preview") {
		return `${name} is reserved for ${name === "canary" ? "release channel canaries" : "pull request previews"}.`;
	}
	if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
		return "Use up to 32 lowercase letters, digits and dashes, e.g. staging or eu-prod.";
	}
	return null;
}

/** The environment name to store for what the operator typed: trimmed and lowercased, null for blank or production. */
export function normalizeEnvironmentName(
	name: string | null | undefined,
): string | null {
	const value = (name ?? "").trim().toLowerCase();
	return value && value !== "production" ? value : null;
}

/** The environments to offer as a filter: the built-in three, then every other name in `used`, alphabetically. */
export function deploymentEnvironments(used: string[]): string[] {
	const custom = used
		.filter(
			(name) => !(DEPLOY_ENVIRONMENTS as readonly string[]).includes(name),
		)
		.toSorted((a, b) => a.localeCompare(b));
	return [...DEPLOY_ENVIRONMENTS, ...custom];
}

/** How an environment name reads on a badge, any custom name as is. */
export function environmentLabel(environment: string): string {
	const labels: Record<string, string> = {
		canary: "Canary",
		preview: "Preview",
		production: "Production",
	};
	return labels[environment] ?? environment;
}

/**
 * Whether `tag` matches a glob `pattern`: `*` matches any run of characters,
 * slashes included, `?` exactly one, everything else literally.
 */
export function matchesTagPattern(pattern: string, tag: string): boolean {
	const source = pattern
		.split("")
		.map((char) => {
			if (char === "*") {
				return ".*";
			}
			if (char === "?") {
				return ".";
			}
			return char.replace(/[\\^$.|+()[\]{}]/g, "\\$&");
		})
		.join("");
	return new RegExp(`^${source}$`).test(tag);
}

/**
 * The slug of a service's canary: `<slug>-canary`, with the parent slug cut
 * short so the whole thing stays a valid 63 character DNS label.
 */
export function canarySlug(parentSlug: string): string {
	return childSlug(parentSlug, "canary");
}

/** Why a tag pattern can't be used, null when it's fine. */
export function tagPatternProblem(pattern: string): string | null {
	if (!pattern.trim()) {
		return "Enter a tag pattern, e.g. v*.";
	}
	if (/\s/.test(pattern)) {
		return "A tag pattern can't contain spaces.";
	}
	return null;
}

export const ENVIRONMENT_PRESETS = [
	"prod",
	"staging",
	"canary",
	"test",
	"dev",
	"demo",
] as const;

/**
 * Why `name` can't be a new environment of a service, null when it's fine:
 * a valid name, not `preview` or a pull request preview's `pr-<number>`, not
 * one the service or its other environments already use, and not `canary`
 * while release channels own it.
 */
export function newEnvironmentProblem(
	name: string,
	service: { channelsEnabled: boolean; taken: string[] },
): string | null {
	if (!name) {
		return "Give the environment a name.";
	}
	if (/^pr-\d+$/.test(name)) {
		return `${name} is reserved for pull request previews.`;
	}
	if (name === "canary" && service.channelsEnabled) {
		return "canary is this service's release channel canary while channels are on.";
	}
	if (service.taken.includes(name)) {
		return `This service already has a ${name} environment.`;
	}
	return name === "canary" ? null : environmentNameProblem(name);
}
