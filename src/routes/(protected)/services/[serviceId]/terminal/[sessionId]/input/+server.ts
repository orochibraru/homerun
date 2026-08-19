import { json } from "@sveltejs/kit";
import { writeToSession } from "$lib/server/docker/terminal";

export const POST = async ({ params, request, locals }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const data = typeof body?.data === "string" ? body.data : null;
  if (data === null) {
    return json({ error: "Missing data" }, { status: 400 });
  }

  const ok = writeToSession(params.sessionId, locals.user.id, data);
  if (!ok) {
    return json({ error: "Session not found" }, { status: 404 });
  }
  return json({ success: true });
};
