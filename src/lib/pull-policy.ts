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
