import { TemplateDTO } from "$lib/dto/template-dto";

export const load = async ({ parent }) => {
  const { user } = await parent();

  const templates = await TemplateDTO.listForUser(user.id);

  return {
    builtins: templates.filter((t) => t.isBuiltin).map((t) => t.toJSON()),
    mine: templates.filter((t) => !t.isBuiltin).map((t) => t.toJSON()),
  };
};
