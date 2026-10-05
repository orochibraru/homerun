import { redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { resolve } from "$app/paths";

export const load = async ({ parent, url }) => {
	const { user } = await parent();
	if (user.role !== "admin") {
		throw redirect(302, resolve(""));
	}
	const projects = await IacProjectDTO.list();
	return {
		origin: config.auth.origin ?? url.origin,
		projects: projects.map((project) => ({
			id: project.id,
			name: project.name,
		})),
	};
};
