import { z } from "zod";
import { requireUser } from "#lib/server/remote-auth.js";
import { ApiService } from "#lib/services/api.service.js";
import { query } from "$app/server";

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

export const checkImage = query(
	imageCheckInput,
	async (input): Promise<ImageCheck> => {
		requireUser();

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
