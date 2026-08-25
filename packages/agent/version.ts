// Same approach as cli/version.ts: no separate agent/package.json (see
// TODO.md's chore item questioning why installer/agent have their own
// package.json at all, given both compile to a standalone binary), so this
// reads the repo root's version directly rather than a second hardcoded
// string that drifts (http.ts's health check and openapi.ts's spec both
// used to hardcode "0.1.0", already stale against the real 0.2.0 release,
// exactly the drift this avoids).
import pkg from "../../package.json";

export const AGENT_VERSION: string = pkg.version;
