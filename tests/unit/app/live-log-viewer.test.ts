import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/svelte";

/**
 * Imported inside each test, not at module scope: Svelte 5 compiles this
 * component's event handlers into a module-level `delegate([...])` call that
 * touches `document`, and the DOM only exists between svelte-loader.ts's
 * `beforeEach`/`afterEach` (see tests/unit/app/README.md).
 */
async function viewer() {
	return (await import("../../../src/lib/components/live-log-viewer.svelte"))
		.default;
}

describe("LiveLogViewer", () => {
	test("a swarm service's logs are not treated as undeployed", async () => {
		// The real bug: swarm mode leaves containerId null and sets
		// swarmServiceId, and the panel used to gate on containerId alone, so a
		// healthy swarm service was told it had never been deployed.
		const { queryByText } = render(await viewer(), {
			serviceId: "svc-1",
			workloadId: "p10z6a15p3an0r",
		});

		expect(queryByText("This service hasn't been deployed yet.")).toBeNull();
	});

	test("says so only when there is no workload at all", async () => {
		const { getByText } = render(await viewer(), {
			serviceId: "svc-1",
			workloadId: null,
		});

		expect(getByText("This service hasn't been deployed yet.")).not.toBeNull();
	});

	test("Reconnect stays enabled whatever the workload's health", async () => {
		const { getByRole } = render(await viewer(), {
			serviceId: "svc-1",
			workloadId: "dead-container-id",
		});

		expect(
			getByRole("button", { name: /Reconnect/ }).hasAttribute("disabled"),
		).toBe(false);
	});
});
