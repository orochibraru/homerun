export interface TunnelContainer {
	HostConfig?: { NetworkMode?: string };
	Image: string;
	Names: string[];
	NetworkSettings?: { Networks?: Record<string, unknown> };
}

const LEADING_SLASH_RE = /^\//;

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
