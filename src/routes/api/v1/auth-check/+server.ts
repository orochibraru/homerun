/**
 * Target for Traefik's forwardAuth middleware (see docker/labels.ts) —
 * gatekeeps a service with authRequired=true behind this app's own
 * session. Traefik forwards the original request's headers (including
 * cookies) here and only lets the request through on a 2xx response;
 * anything else and Traefik returns that status to the original caller
 * directly, never reaching the gated service.
 *
 * Deliberately just checks `locals.user` (populated by hooks.server.ts
 * from either a cookie session or an API key) rather than a bespoke
 * check — "logged into this instance" is the gate, via whichever
 * provider the user authenticated with (including any configured OIDC
 * provider — see auth.ts's genericOAuth plugin).
 */
export const GET = ({ locals }) => {
  if (!locals.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  return new Response("OK", { status: 200 });
};
