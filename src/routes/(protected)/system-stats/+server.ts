import { json } from "@sveltejs/kit";
import { getSystemStats } from "$lib/server/system-stats";

export const GET = async ({ locals }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = await getSystemStats();
  return json(stats);
};
