const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export const DASHBOARD_ROUTER_FILE = "homerun-dashboard.yml";

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

export function dashboardRouterConfig(params: {
	certResolver: string;
	entrypoint: string;
	host: string;
	target: string;
}): string {
	const tls = IPV4_RE.test(params.host)
		? "      tls: {}"
		: `      tls:\n        certResolver: ${params.certResolver}`;
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
