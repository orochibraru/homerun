import { error } from "@sveltejs/kit";
import { ownedProject } from "$lib/server/projects";

export const load = async ({ params, parent }) => {
  const { user } = await parent();

  const row = await ownedProject(params.projectId, user.id);
  if (!row) {
    error(404, "Project not found");
  }

  return { project: row };
};
