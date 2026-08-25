import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/svelte";
import StatusBadge from "../../../src/lib/components/status-badge.svelte";
import type { ContainerStatus } from "../../../src/lib/types";

/**
 * First real component test wired onto tests/unit/app/'s scaffolded
 * svelte-loader + happy-dom setup (see that folder's own README), rather than
 * the bare "not yet wired to any real component tests" placeholder it was
 * left at.
 */
describe("StatusBadge", () => {
	test("renders the label for each known status", () => {
		const cases: Array<[ContainerStatus, string]> = [
			["running", "Running"],
			["stopped", "Stopped"],
			["failed", "Failed"],
			["pending", "Pending"],
			["pulling", "Pulling"],
			["starting", "Starting"],
		];

		for (const [status, label] of cases) {
			const { container, unmount } = render(StatusBadge, { status });
			expect(container.querySelector("span")?.textContent?.trim()).toBe(label);
			unmount();
		}
	});

	test("spins the icon while pulling or starting, not for a settled status", () => {
		const { container: pulling, unmount: unmountPulling } = render(
			StatusBadge,
			{
				status: "pulling",
			},
		);
		expect(pulling.querySelector(".animate-spin")).not.toBeNull();
		unmountPulling();

		const { container: running, unmount: unmountRunning } = render(
			StatusBadge,
			{
				status: "running",
			},
		);
		expect(running.querySelector(".animate-spin")).toBeNull();
		unmountRunning();
	});
});
