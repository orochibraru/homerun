import { ProjectDTO } from "$lib/dto/project-dto";

export const load = async ({ parent }) => {
  const { user } = await parent();

  const rows = await ProjectDTO.listWithServiceCounts(user.id);

  return {
    projects: rows.map((r) => ({
      ...r.project.toJSON(),
      serviceCount: r.serviceCount,
    })),
  };
};
