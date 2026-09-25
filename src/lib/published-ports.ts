export interface PublishedPort {
	containerPort: number;
	hostPort: number;
	protocol: "tcp" | "udp";
}

export const RESERVED_HOST_PORTS = [80, 443];

/** The `<containerPort>/<protocol>` key Docker uses for a port in `ExposedPorts` and `PortBindings`. */
export function portKey(port: PublishedPort): string {
	return `${port.containerPort}/${port.protocol}`;
}

/**
 * The Engine `PortBindings` for a container's published ports, binding every
 * host interface. Undefined when nothing is published, so the create body
 * stays as it was.
 */
export function portBindings(
	ports: PublishedPort[],
): Record<string, { HostPort: string }[]> | undefined {
	if (ports.length === 0) {
		return;
	}
	const bindings: Record<string, { HostPort: string }[]> = {};
	for (const port of ports) {
		const key = portKey(port);
		bindings[key] = [
			...(bindings[key] ?? []),
			{ HostPort: `${port.hostPort}` },
		];
	}
	return bindings;
}

/**
 * The first problem with a service's published ports, or null: a host port
 * outside 1-65535 or reserved for Traefik, or the same host port and protocol
 * listed twice.
 */
export function publishedPortsProblem(ports: PublishedPort[]): string | null {
	const seen = new Set<string>();
	for (const port of ports) {
		if (
			RESERVED_HOST_PORTS.includes(port.hostPort) &&
			port.protocol === "tcp"
		) {
			return `Host port ${port.hostPort}/tcp is Traefik's : route HTTP(S) through a domain instead.`;
		}
		const key = `${port.hostPort}/${port.protocol}`;
		if (seen.has(key)) {
			return `Host port ${key} is listed twice.`;
		}
		seen.add(key);
	}
	return null;
}
