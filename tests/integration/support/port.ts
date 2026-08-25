/**
 * Asks the OS for a free TCP port by binding to port 0 and reading back
 * whatever it assigned, then releasing it immediately : the standard
 * "get-port" trick. Used for every port this suite needs (the throwaway
 * Postgres container, the spawned app, the spawned agent, the socat proxy)
 * so multiple runs of this suite — two terminals, two CI jobs, a local run
 * next to a CI run — can execute concurrently without colliding on a fixed
 * port. Small TOCTOU race (something else could grab the port between our
 * release and the real listener's bind) is an accepted, standard tradeoff
 * for test infra, same one every "get-port"-style library carries.
 */
export function getFreePort(): number {
	const server = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: {
			data() {
				// Never actually receives traffic : closed immediately below.
			},
		},
	});
	const { port } = server;
	server.stop(true);
	return port;
}
