import type { GitProviderKind } from "#lib/server/db/schema.js";

export const GIT_PROVIDER_KIND_LABELS: Record<GitProviderKind, string> = {
	bitbucket: "Bitbucket",
	gitea: "Gitea",
	github: "GitHub",
	gitlab: "GitLab",
};
