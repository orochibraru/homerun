export interface TunnelContainer {
	HostConfig?: { NetworkMode?: string };
	Image: string;
	Names: string[];
	NetworkSettings?: { Networks?: Record<string, unknown> };
}

const LEADING_SLASH_RE = /^\//;

/**
 * The hostname the dashboard's Traefik router should target when running
 * behind a Pangolin tunnel : the Traefik container's own name (reachable by
 * Docker DNS) when it and the `fosrl/newt` tunnel container share a network
 * and newt isn't on host networking, otherwise falls back to `"localhost"`.
 */
export function tunnelTargetHostFrom(containers: TunnelContainer[]): string {
	const newt = containers.find((c) => c.Image.includes("fosrl/newt"));
	const traefik = containers.find((c) => c.Image.startsWith("traefik"));
	if (!(newt && traefik) || newt.HostConfig?.NetworkMode === "host") {
		return "localhost";
	}
	const newtNetworks = Object.keys(newt.NetworkSettings?.Networks ?? {});
	const shared = Object.keys(traefik.NetworkSettings?.Networks ?? {}).some(
		(network) => newtNetworks.includes(network),
	);
	const name = traefik.Names[0]?.replace(LEADING_SLASH_RE, "");
	return shared && name ? name : "localhost";
}
