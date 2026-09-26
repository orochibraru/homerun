import { AUTH_CHECK_ALIAS } from "../self-update/compose-target.ts";

export const DASHBOARD_ROUTER_FILE = "homerun-dashboard.yml";

/**
 * The file router's priority, far above the rule-length default a Docker
 * label router gets, so for the dashboard's host this one always wins over
 * the app container's own compose labels and the two never race. It has to
 * win rather than only back the label up: Traefik's Docker provider inspects
 * every container before building any route, so one container the daemon is
 * wedged on freezes every label route (gone after a Traefik restart, or
 * pointing at a replaced container's old address), while this route resolves
 * the app by name on every connection and needs nothing from the Docker
 * provider at all.
 */
export const DASHBOARD_ROUTER_PRIORITY = 10_000;

export type DashboardRouterPlan =
	| { action: "keep" }
	| { action: "remove" }
	| { action: "write"; target: string };

/**
 * What `syncDashboardRouter` should do with the dashboard's router file:
 * remove it when no host is configured, leave it alone when this app's own
 * container can't be inspected (the worker is down, or dev outside Docker,
 * neither of which is a reason to take a working route away), and otherwise
 * always (re)write it, pointing at the `homerun-auth` alias when the
 * container has it (the self-updater's candidate takes that alias over while
 * the app container is swapped, so the dashboard keeps answering through an
 * update), else at the container's name or address on the shared network.
 */
export function dashboardRouterPlan(
	host: string | null,
	self: {
		aliases: string[];
		name: string | null;
		networkAddress: string | null;
	} | null,
): DashboardRouterPlan {
	if (!host) {
		return { action: "remove" };
	}
	const target = self?.aliases.includes(AUTH_CHECK_ALIAS)
		? AUTH_CHECK_ALIAS
		: (self?.name ?? self?.networkAddress ?? null);
	return target ? { action: "write", target } : { action: "keep" };
}

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
      priority: ${DASHBOARD_ROUTER_PRIORITY}
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
