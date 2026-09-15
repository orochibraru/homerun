import type { PullPolicy } from "$lib/types";

export const PULL_POLICIES: ReadonlyArray<{
	description: string;
	label: string;
	value: PullPolicy;
}> = [
	{
		description:
			"Pull on every deploy. A moving tag like :latest only picks up a new build this way.",
		label: "Always",
		value: "always",
	},
	{
		description:
			"Pull only when the image isn't already on the host. Faster redeploys, but a moving tag goes stale.",
		label: "If missing",
		value: "missing",
	},
	{
		description:
			"Never pull. For an image built or loaded onto this host by hand : the deploy fails if it isn't there.",
		label: "Never",
		value: "never",
	},
];

export function shouldSkipPull(
	policy: PullPolicy,
	presentLocally: boolean,
): string | null {
	if (policy === "always") {
		return null;
	}
	if (policy === "never") {
		return presentLocally
			? "Pull policy is Never : using the image already on this host."
			: "Pull policy is Never, and the image isn't on this host.";
	}
	return presentLocally
		? "Pull policy is If missing : the image is already on this host."
		: null;
}
