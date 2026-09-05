import { z } from "zod";
import { query } from "$app/server";
import { requireUser } from "$lib/server/remote-auth";
import { ApiService } from "$lib/services/api.service";

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
