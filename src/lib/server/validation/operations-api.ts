import { z } from "zod";

import { UPDATE_SCOPES } from "#lib/image-versions.js";
import { dockerCleanupActions } from "#lib/services/queue/payloads.js";

export const serviceVersionWatchApiBody = z
	.object({
		updateCheckEnabled: z
			.boolean()
			.optional()
			.describe(
				"Watch the registry for a newer release (a version tag) or a new image behind a floating tag like latest.",
			),
		updateScope: z
			.enum(UPDATE_SCOPES)
			.optional()
			.describe(
				"How far an update may go from the running version tag: major (any newer release), minor (same major) or patch (same major.minor).",
			),
		updateTrialEnabled: z
			.boolean()
			.optional()
			.describe(
				"Try each update in a throwaway container on its networks, with no volumes or routing, before notifying it.",
			),
	})
	.refine(
		(body) =>
			body.updateCheckEnabled !== undefined ||
			body.updateScope !== undefined ||
			body.updateTrialEnabled !== undefined,
		"Send updateCheckEnabled, updateScope, updateTrialEnabled or any of them.",
	);

export const servicePinApiBody = z.object({
	local: z
		.boolean()
		.default(false)
		.describe(
			"Tag the running image on this host instead, for an image no registry tag matches; the pull policy moves to missing.",
		),
	tag: z
		.string()
		.trim()
		.min(1)
		.max(128)
		.describe(
			"The tag to pin to: one of the matches GET /version/pin found, or a new local tag with local true.",
		),
});

export const dockerCleanupApiBody = z.object({
	action: z
		.enum(dockerCleanupActions)
		.describe(
			"What to prune: pruneContainers (stopped containers), pruneImages (dangling images, every unused one with all), pruneNetworks, pruneBuildCache, pruneVolumes (unused Docker volumes, never one a service mounts), pruneSystem (containers, dangling images, networks and build cache), pruneMirror (the image mirror's unused images) or reclaimStackNetworks (networks of deleted stacks).",
		),
	all: z
		.boolean()
		.default(false)
		.describe("pruneImages only: every unused image, tagged ones included."),
});
