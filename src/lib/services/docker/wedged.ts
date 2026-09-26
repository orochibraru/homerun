export interface WedgedContainer {
	id: string;
	name: string;
	since: string;
}

/**
 * The operator-facing explanation of the helper containers the worker's
 * janitor couldn't remove because the Docker daemon stopped answering for
 * them, or null when there are none.
 */
export function wedgedMessage(wedged: WedgedContainer[]): string | null {
	if (wedged.length === 0) {
		return null;
	}
	const names = wedged
		.map((container) => `${container.name} (${container.id.slice(0, 12)})`)
		.join(", ");
	const subject =
		wedged.length === 1
			? `the helper container ${names}`
			: `${wedged.length} helper containers: ${names}`;
	return `Docker is stuck on ${subject}: the daemon no longer answers inspect or remove for it. While it's stuck, Traefik's Docker provider can't build routes (sites routed by container labels may answer 404) and jobs touching it fail. Restart Docker on the host to clear it: sudo systemctl restart docker`;
}

/**
 * Turns the worker's wedged-container list, polled over and over, into one
 * notification per newly wedged container: a container stays reported until
 * the worker stops listing it, and one that wedges again after clearing is
 * reported again.
 */
export class WedgedReporter {
	#known = new Set<string>();

	/** Calls `notify` with the message for the containers in `wedged` not reported yet, and forgets the ones no longer listed. */
	report(wedged: WedgedContainer[], notify: (message: string) => void): void {
		const fresh = wedged.filter((container) => !this.#known.has(container.id));
		this.#known = new Set(wedged.map((container) => container.id));
		const message = wedgedMessage(fresh);
		if (message) {
			notify(message);
		}
	}
}
