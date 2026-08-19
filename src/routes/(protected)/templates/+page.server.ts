import { ProjectDTO } from "$lib/dto/project-dto";
import { TemplateDTO } from "$lib/dto/template-dto";

export const load = async ({ parent, url }) => {
  const { user } = await parent();

  const templates = await TemplateDTO.listForUser(user.id);

  // Carried through to each "Deploy" link so deploying from here while
  // browsing a project's templates lands the new service in that project.
  // Ignore a projectId that isn't actually the user's own, rather than
  // erroring — deploying just falls back to ungrouped.
  const rawProjectId = url.searchParams.get("projectId");
  const project = rawProjectId
    ? await ProjectDTO.get(rawProjectId, user.id)
    : null;

  return {
    builtins: templates.filter((t) => t.isBuiltin).map((t) => t.toJSON()),
    mine: templates.filter((t) => !t.isBuiltin).map((t) => t.toJSON()),
    project: project?.toJSON() ?? null,
  };
};
