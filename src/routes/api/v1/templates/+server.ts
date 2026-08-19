import { json } from "@sveltejs/kit";
import { TemplateDTO } from "$lib/dto/template-dto";

export const GET = async ({ locals }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const templates = await TemplateDTO.listForUser(locals.user.id);
  return json(templates.map((t) => t.toJSON()));
};
