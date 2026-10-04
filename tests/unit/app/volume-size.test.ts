import { afterEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { WorkerClient } = await import("../../../src/lib/server/worker-client");
const { VolumeSizeService } = await import(
	"../../../src/lib/services/volume-size.service"
);

afterEach(() => restoreStubs());

describe("VolumeSizeService", () => {
	test("measures once, reuses the size for ten minutes, and reports failures per source", async () => {
		const asked: string[][] = [];
		stub(
			WorkerClient,
			"post",
			async (_path: string, body: { image: string; sources: string[] }) => {
				asked.push(body.sources);
				expect(body.image).toBe("alpine:3");
				return body.sources.map((source) =>
					source === "broken"
						? { bytes: null, error: "du exited 1", source }
						: { bytes: 2048, source },
				);
			},
		);
		const start = new Date("2026-09-29T10:00:00Z");
		const first = await VolumeSizeService.sizes(["a", "broken", "a"], start);
		expect(first.get("a")?.bytes).toBe(2048);
		expect(first.get("broken")).toMatchObject({
			bytes: null,
			error: "du exited 1",
		});

		await VolumeSizeService.sizes(["a"], new Date(start.getTime() + 60_000));
		await VolumeSizeService.sizes(
			["a"],
			new Date(start.getTime() + 11 * 60_000),
		);
		expect(asked).toEqual([["a", "broken"], ["a"]]);

		VolumeSizeService.forget("a");
		stub(WorkerClient, "post", async () => {
			throw new Error("worker down");
		});
		const down = await VolumeSizeService.sizes(
			["a"],
			new Date(start.getTime() + 12 * 60_000),
		);
		expect(down.get("a")).toMatchObject({ bytes: null, error: "worker down" });
	});
});
