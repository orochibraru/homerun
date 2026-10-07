import { describe, expect, test } from "bun:test";
import { matchBackend } from "../../../src/lib/iac/backend-match";

const projects = [
	{ id: "homelab", name: "Homelab" },
	{ id: "media", name: "media-stack" },
	{ id: "media-prod", name: "Media stack (production)" },
	{ id: "blog", name: "My blog" },
];

describe("matchBackend", () => {
	test("prefers an exact match, ignoring case and punctuation", () => {
		expect(matchBackend("homelab", projects)).toBe("homelab");
		expect(matchBackend("Media Stack", projects)).toBe("media");
	});

	test("matches a name containing the other, the closest first", () => {
		expect(matchBackend("media", projects)).toBe("media");
		expect(matchBackend("homelab-services", projects)).toBe("homelab");
	});

	test("falls back to a shared word", () => {
		expect(matchBackend("blog engine", projects)).toBe("blog");
	});

	test("returns null when nothing is close", () => {
		expect(matchBackend("grafana", projects)).toBeNull();
		expect(matchBackend("", projects)).toBeNull();
		expect(matchBackend("my", projects)).toBeNull();
		expect(matchBackend("lab", projects)).toBeNull();
		expect(matchBackend("homelab", [])).toBeNull();
	});
});
