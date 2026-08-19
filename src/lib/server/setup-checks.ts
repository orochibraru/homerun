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
 * Lightweight diagnostics for "is this instance actually configured", not
 * a live-editable settings store — config here stays env-var driven by
 * design (see $lib/config.ts). Surfaced as a dashboard banner + a
 * dedicated /setup page linking each finding back to the env var that
 * fixes it, rather than a DNS/SSL-provider automation flow (out of scope
 * here — see TODO.md's Onboarding section for the larger version of this).
 */
export async function runSetupChecks(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];

  checks.push(
    config.baseDomain === "localhost"
      ? {
          detail:
            "Deployed services will only be reachable at <slug>.localhost from this machine — set a real domain for public routing.",
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
        }
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
        }
  );

  checks.push(
    config.auth.origin === "http://localhost:3000"
      ? {
          detail:
            "Using the default origin — auth callbacks/redirects may misbehave once this isn't served from localhost:3000.",
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
        }
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
        }
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
          detail: `Couldn't reach the Docker socket at ${config.docker.socketPath} — nothing will deploy until this is fixed.`,
          envVar: "DOCKER_SOCKET_PATH",
          id: "docker",
          label: "Docker socket",
          severity: "danger",
        }
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
              "SMTP_ENABLED is true but one or more of SMTP_HOST/PORT/USER/PASSWORD/FROM is missing — email verification won't work.",
            envVar:
              "SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM",
            id: "smtp",
            label: "Email (SMTP)",
            severity: "danger",
          }
    );
  }

  return checks;
}
