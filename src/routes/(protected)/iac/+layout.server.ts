import { config } from "#lib/config.js";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";

export const load = async ({ parent, url }) => {
	await parent();
	const projects = await IacProjectDTO.list();
	return {
		origin: config.auth.origin ?? url.origin,
		projects: projects.map((project) => ({
			id: project.id,
			name: project.name,
		})),
	};
};
