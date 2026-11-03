import { resolve } from "$app/paths";

import type { ActivitySnapshot } from "#lib/activity.js";

export class ActivityFeedClient {
	snapshot = $state<ActivitySnapshot | null>(null);
	connected = $state(false);
	now = $state(Date.now());

	/**
	 * Follows `/activity`'s live stream for as long as the component that
	 * constructed it is mounted: the browser's EventSource reconnects by itself
	 * after a drop, and a one-second clock keeps elapsed times ticking between
	 * snapshots. Must be constructed during component init.
	 */
	constructor() {
		$effect(() => {
			const source = new EventSource(resolve("activity"));
			source.addEventListener("activity", (event) => {
				this.snapshot = JSON.parse(event.data) as ActivitySnapshot;
				this.connected = true;
			});
			source.addEventListener("error", () => {
				this.connected = false;
			});
			const clock = setInterval(() => {
				this.now = Date.now();
			}, 1000);
			return () => {
				clearInterval(clock);
				source.close();
			};
		});
	}
}
