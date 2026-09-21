import { WorkerClient } from "$lib/server/worker-client";

/**
 * Shared base every Docker concern class extends (containers, networks,
 * terminal, swarm, custom-ssl, core-services, reconcile) : each one is its own
 * real class, not a bag of loose exported functions, and all of them merge
 * into one `DockerService` via the TS mixin functions each file exports (see
 * docker.service.ts for the merge order).
 *
 * This base used to hand out a dockerode client. It now hands out the Go
 * worker's Docker control API instead : the app holds no Docker socket at all,
 * the worker is the process that does, and every engine call goes over HTTP to
 * it. What did *not* change is the split of responsibilities — deciding what
 * should happen (labels, container specs, swarm templates, keep sets) stays
 * here with the database, and the worker only performs the call and reports
 * what it saw.
 *
 * Not `abstract` : TS's mixin pattern requires a concrete (instantiable) base
 * constructor type, and this class is never instantiated on its own anyway,
 * only ever as the bottom of the merge chain in docker.service.ts.
 */
export class BaseDockerService {
	/** The Go worker's Docker control API, which every concern's engine calls go through. */
	get worker(): typeof WorkerClient {
		return WorkerClient;
	}
}

/**
 * The TS mixin pattern : a mixin is a function `(Base) => class extends
 * Base {...}`, so each concern class genuinely extends whatever it's
 * given (BaseDockerService, or another already-mixed-in concern further
 * down the chain) rather than just being merged in by object-spread.
 * `docker.service.ts` composes the full chain and instantiates it once.
 *
 * `...args: any[]` (rather than `unknown[]`) is TypeScript's own required
 * shape for a mixin's base constructor type, not a real escape hatch,
 * every concern class here still declares a no-arg (or explicit
 * zero-param) constructor, this is purely what the mixin pattern's type
 * constraint demands.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- TS's mixin pattern requires this exact constructor shape
export type Constructor<T = object> = new (...args: any[]) => T;
