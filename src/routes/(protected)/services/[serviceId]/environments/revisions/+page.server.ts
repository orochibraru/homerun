import { RevisionService } from "#lib/services/revision.service.js";

export const load = async ({ parent }) => {
	const { service } = await parent();
	return { revisions: await RevisionService.history(service) };
};
