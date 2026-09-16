export const DASHBOARD_ROUTER_FILE = "homerun-dashboard.yml";

/**
 * The bare hostname to route the dashboard's own Traefik router on, derived
 * from the configured Dashboard URL. Returns null when there's no origin
 * configured, or when the origin includes an explicit port : Traefik's
 * `Host()` rule can't match a port, so a port-qualified origin means the
 * dashboard should stay unrouted (reached directly instead).
 */
export function dashboardHostFrom(origin: string | null): string | null {
	if (!origin) {
		return null;
	}
	try {
		const url = new URL(origin);
		return url.port ? null : url.hostname;
	} catch {
		return null;
	}
}

/** Renders the Traefik dynamic-config YAML that routes `params.host` to the dashboard itself, for writing to `DASHBOARD_ROUTER_FILE`. */
export function dashboardRouterConfig(params: {
	certResolver: string | null;
	entrypoint: string;
	host: string;
	target: string;
}): string {
	const tls = params.certResolver
		? `      tls:\n        certResolver: ${params.certResolver}`
		: "      tls: {}";
	return `# Written by Homerun from the Dashboard URL in Settings : do not edit by hand.
http:
  routers:
    homerun-dashboard:
      rule: Host(\`${params.host}\`)
      entryPoints:
        - ${params.entrypoint}
      service: homerun-dashboard
${tls}
  services:
    homerun-dashboard:
      loadBalancer:
        servers:
          - url: ${params.target}
`;
}
