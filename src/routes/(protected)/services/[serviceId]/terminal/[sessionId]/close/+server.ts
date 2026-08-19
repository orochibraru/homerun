import { json } from "@sveltejs/kit";
import { closeSession, ownsSession } from "$lib/server/docker/terminal";

export const POST = ({ params, locals }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ownsSession(params.sessionId, locals.user.id)) {
    closeSession(params.sessionId);
  }
  return json({ success: true });
};
