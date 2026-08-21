import type Docker from "dockerode";
import { getDocker, type RemoteHostConnection } from "./client.ts";

export type { RemoteHostConnection } from "./client.ts";

/**
 * Shared base every Docker concern class extends (containers, networks,
 * terminal, git-build, custom-ssl, core-services, reconcile) : each one is
 * its own real class, not a bag of loose exported functions, and all of
 * them merge into one `DockerService` via the TS mixin functions each file
 * exports (see docker.service.ts for the merge order). This base just
 * wraps client.ts's HMR-safe connection cache so every concern method can
 * call `this.getDocker(remote)` instead of importing `getDocker` directly.
 * Public, not protected : some callers (e.g. admin.service.ts's Docker
 * socket reachability check) need the raw dockerode client directly,
 * same as when this was a static `DockerService.getDocker` delegate.
 * Not `abstract` : TS's mixin pattern requires a concrete (instantiable)
 * base constructor type, and this class is never instantiated on its
 * own anyway, only ever as the bottom of the merge chain in
 * docker.service.ts.
 */
export class BaseDockerService {
	getDocker(remote?: RemoteHostConnection | null): Docker {
		return getDocker(remote);
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
// biome-ignore lint/suspicious/noExplicitAny: TS's mixin pattern requires this exact constructor shape
export type Constructor<T = object> = new (...args: any[]) => T;
