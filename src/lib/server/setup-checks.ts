import { config, isSmtpEnabled } from "$lib/config";
import { getDocker } from "$lib/server/docker/client";
import { findTraefikContainer } from "$lib/server/docker/core-services";

export interface SetupCheck {
	detail: string;
	envVar?: string;
	id: string;
	label: string;
	severity: "ok" | "warn" | "danger";
}

/**
 * Maps a check's id to the `/settings` field id(s) it corresponds to, so the
 * dashboard banner can deep-link straight to (and highlight) the offending
 * field instead of just linking to the page in general. "auth-secret" (env
 * only, no /settings field) and "traefik" (a live container check, not a
 * form input) are deliberately absent — nothing to highlight for either.
 */
export const SETUP_CHECK_FIELDS: Record<string, string[]> = {
	"base-domain": ["baseDomain"],
	docker: ["dockerSocketPath"],
	origin: ["authOrigin"],
	smtp: ["smtpHost", "smtpPort", "smtpUser", "smtpPassword", "smtpFrom"],
};

/**
 * Lightweight diagnostics for "is this instance actually configured".
 * `config` here already reflects DB-backed instance settings merged over
 * env defaults (see $lib/config.ts's applyInstanceSettings() and the
 * /settings page) — these checks just report the effective value, they
 * don't care which layer it came from. `envVar` is still worth showing:
 * it's the env-var equivalent for anyone bootstrapping via docker-compose
 * before ever visiting /settings. Still no DNS/SSL-provider automation
 * flow — out of scope here, see TODO.md's Onboarding section.
 */
export async function runSetupChecks(): Promise<SetupCheck[]> {
	const checks: SetupCheck[] = [];

	checks.push(
		config.baseDomain === "localhost"
			? {
					detail:
						"Deployed services will only be reachable at <slug>.localhost from this machine — set a real domain for public routing (env var below, or the Core section of /settings).",
					envVar: "BASE_DOMAIN",
					id: "base-domain",
					label: "Base domain",
					severity: "warn",
				}
			: {
					detail: `Services are routed under <slug>.${config.baseDomain}.`,
					id: "base-domain",
					label: "Base domain",
					severity: "ok",
				},
	);

	checks.push(
		config.auth.secret === "default-secret"
			? {
					detail:
						"Using the built-in placeholder auth secret — sessions aren't safe against a compromised install. Generate a real one (e.g. `openssl rand -base64 32`).",
					envVar: "AUTH_SECRET (or BETTER_AUTH_SECRET)",
					id: "auth-secret",
					label: "Auth secret",
					severity: "danger",
				}
			: {
					detail: "A non-default auth secret is set.",
					id: "auth-secret",
					label: "Auth secret",
					severity: "ok",
				},
	);

	checks.push(
		config.auth.origin === "http://localhost:3000"
			? {
					detail:
						"Using the default origin — auth callbacks/redirects may misbehave once this isn't served from localhost:3000 (env var below, or the Core section of /settings).",
					envVar: "ORIGIN",
					id: "origin",
					label: "Origin URL",
					severity: "warn",
				}
			: {
					detail: `Origin set to ${config.auth.origin}.`,
					id: "origin",
					label: "Origin URL",
					severity: "ok",
				},
	);

	const traefik = await findTraefikContainer().catch(() => null);
	checks.push(
		traefik
			? {
					detail: `Found running as ${traefik.name}.`,
					id: "traefik",
					label: "Traefik ingress",
					severity: "ok",
				}
			: {
					detail:
						"No running Traefik container found — deployed services won't get public routing/TLS until it's started (see compose.yaml).",
					id: "traefik",
					label: "Traefik ingress",
					severity: "warn",
				},
	);

	const dockerOk = await getDocker()
		.ping()
		.then(() => true)
		.catch(() => false);
	checks.push(
		dockerOk
			? {
					detail: "Connected.",
					id: "docker",
					label: "Docker socket",
					severity: "ok",
				}
			: {
					detail: `Couldn't reach the Docker socket at ${config.docker.socketPath} — nothing will deploy until this is fixed (env var below, or the Docker section of /settings).`,
					envVar: "DOCKER_SOCKET_PATH",
					id: "docker",
					label: "Docker socket",
					severity: "danger",
				},
	);

	if (config.smtp.enabled) {
		checks.push(
			isSmtpEnabled()
				? {
						detail: `Configured via ${config.smtp.host}.`,
						id: "smtp",
						label: "Email (SMTP)",
						severity: "ok",
					}
				: {
						detail:
							"SMTP is enabled but one or more of host/port/user/password/from is missing — email verification won't work (env vars below, or the SMTP section of /settings).",
						envVar:
							"SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM",
						id: "smtp",
						label: "Email (SMTP)",
						severity: "danger",
					},
		);
	}

	return checks;
}
