export const DEPLOY_ENVIRONMENTS = ["production", "canary", "preview"] as const;

export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

export const DEFAULT_TAG_PATTERN = "v*";

/** The environment a service's deployments belong to: its release channel canary, a pull request preview, or production. */
export function deployEnvironment(row: {
	channelCanary: boolean;
	previewParentId: string | null;
}): DeployEnvironment {
	if (row.channelCanary) {
		return "canary";
	}
	return row.previewParentId ? "preview" : "production";
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
	const suffix = "-canary";
	return `${parentSlug.slice(0, 63 - suffix.length).replace(/-+$/, "")}${suffix}`;
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
