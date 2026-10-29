import { query } from "$app/server";
import { z } from "zod";

import { BUILD_METHODS } from "#lib/build-methods.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import {
	configFromImage,
	type DetectedConfig,
	type OciImageConfig,
} from "#lib/image-config.js";
import { sortTagsForPicker } from "#lib/image-versions.js";
import { Logger } from "#lib/logger.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import { ApiService } from "#lib/services/api.service.js";
import { DockerService } from "#lib/services/docker.service.js";
import { ManifestService } from "#lib/services/manifest.service.js";

export interface ImageCheck {
	checked: boolean;
	exists: boolean;
}

const imageCheckInput = z.object({
	image: z.string(),
	registryPassword: z.string().optional(),
	registryUrl: z.string().optional(),
	registryUsername: z.string().optional(),
	tag: z.string().optional(),
});

const TAG_PICKER_LIMIT = 500;

const logger = new Logger("Docker");

export const checkImage = query(
	imageCheckInput,
	async (input): Promise<ImageCheck> => {
		requirePermission("services", "read");

		const image = input.image.trim();
		if (!image) {
			return { checked: false, exists: true };
		}

		const tag = input.tag?.trim() || "latest";
		const registryUrl = input.registryUrl?.trim() || null;
		const username = input.registryUsername?.trim();
		const auth = username
			? { password: input.registryPassword ?? "", username }
			: undefined;

		return await ApiService.checkImageExists(image, tag, registryUrl, auth);
	},
);

export const inspectImageConfig = query(
	imageCheckInput,
	async (input): Promise<DetectedConfig | null> => {
		requirePermission("services", "read");

		const image = input.image.trim();
		if (!image) {
			return null;
		}
		const tag = input.tag?.trim() || "latest";
		const registryUrl = input.registryUrl?.trim() || null;
		const username = input.registryUsername?.trim();
		const auth = username
			? { password: input.registryPassword ?? "", username }
			: undefined;

		const remote = await ApiService.fetchImageConfig(
			image,
			tag,
			registryUrl,
			auth,
		).catch((err: unknown) => {
			logger.warn(`Image config lookup failed: ${image}:${tag}`, err);
			return null;
		});
		if (remote) {
			return configFromImage(remote);
		}
		const ref = registryUrl
			? `${registryUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}/${image}:${tag}`
			: `${image}:${tag}`;
		const local = await DockerService.worker
			.get<{ Config?: OciImageConfig | null }>("v1/images/inspect", { ref })
			.catch(() => null);
		return local?.Config ? configFromImage(local.Config) : null;
	},
);

export const detectRepoConfig = query(
	z.object({
		context: z.string(),
		dockerfilePath: z.string(),
		gitUrl: z.string().trim().min(1),
		method: z.enum(BUILD_METHODS),
		ref: z.string().trim().min(1),
	}),
	async (input): Promise<DetectedConfig | null> => {
		const user = requirePermission("services", "read");
		return await ManifestService.detectConfig(input, user.id);
	},
);

export const listImageTags = query(
	z.object({
		image: z.string(),
		registryUrl: z.string().optional(),
		registryUsername: z.string().optional(),
		serviceId: z.string().optional(),
	}),
	async (input): Promise<string[]> => {
		requirePermission("services", "read");

		const image = input.image.trim();
		if (!image) {
			return [];
		}
		const registryUrl = input.registryUrl?.trim() || null;
		const username = input.registryUsername?.trim();
		const svc = input.serviceId ? await ServiceDTO.get(input.serviceId) : null;
		const auth =
			svc && username && svc.registryUsername === username
				? DockerService.buildAuthConfig(svc.toJSON())
				: undefined;

		const tags = await ApiService.listTags(image, { auth, registryUrl }).catch(
			(err: unknown) => {
				logger.warn(`Tag listing failed: ${image}`, err);
				return [];
			},
		);
		return sortTagsForPicker(tags.map((tag) => tag.name)).slice(
			0,
			TAG_PICKER_LIMIT,
		);
	},
);
