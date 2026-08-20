import Docker from "dockerode";
import { config } from "$lib/config";

// HMR-safe singleton cache, same pattern as $lib/server/db/lib.ts's
// Postgres client : avoids leaking a new Docker connection on every
// Vite reload. Keyed by remote host id ("local" for the default socket),
// so a remote connection is only opened once and reused.
const globalForDocker = globalThis as unknown as {
	__docker_clients?: Map<string, Docker>;
};

function clientCache(): Map<string, Docker> {
	if (!globalForDocker.__docker_clients) {
		globalForDocker.__docker_clients = new Map();
	}
	return globalForDocker.__docker_clients;
}

export interface RemoteHostConnection {
	dockerHost: string;
	id: string;
	tlsCa?: string | null;
	tlsCert?: string | null;
	tlsKey?: string | null;
}

/**
 * Parses a `remote_host.dockerHost` value ("tcp://host:2376" or
 * "ssh://user@host") into dockerode constructor options. TLS is implied
 * by the presence of ca/cert/key, not by the URL scheme : Docker's own
 * convention (a bare "tcp://" with certs configured is the same as
 * "https://" to the daemon).
 */
function parseDockerHost(conn: RemoteHostConnection): Docker.DockerOptions {
	const url = new URL(conn.dockerHost);
	const hasTls = !!(conn.tlsCa && conn.tlsCert && conn.tlsKey);

	if (url.protocol === "ssh:") {
		return {
			host: url.hostname,
			port: url.port ? Number(url.port) : 22,
			protocol: "ssh",
			username: url.username || undefined,
		};
	}

	return {
		ca: conn.tlsCa ?? undefined,
		cert: conn.tlsCert ?? undefined,
		host: url.hostname,
		key: conn.tlsKey ?? undefined,
		port: url.port ? Number(url.port) : 2375,
		protocol: hasTls ? "https" : "http",
	};
}

/**
 * Gets (or opens and caches) a Docker client. No argument, or a
 * remoteHostId-less connection object, → the local socket (the only
 * option before remote hosts existed, and still the default for every
 * service). Pass a `RemoteHostConnection` (see RemoteHostDTO) to reach a
 * remote Docker daemon instead : services opt in via `remoteHostId`.
 */
export function getDocker(remote?: RemoteHostConnection | null): Docker {
	const cache = clientCache();
	const key = remote ? remote.id : "local";

	const existing = cache.get(key);
	if (existing) {
		return existing;
	}

	const client = remote
		? new Docker(parseDockerHost(remote))
		: new Docker({ socketPath: config.docker.socketPath });
	cache.set(key, client);
	return client;
}
