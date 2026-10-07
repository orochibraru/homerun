import { describe, expect, test } from "bun:test";
import {
	providerDocs,
	RESOURCE_EXAMPLES,
} from "../../../src/lib/iac/provider-docs";
import {
	IAC_DATA_SOURCES,
	IAC_RESOURCES,
} from "../../../src/lib/iac/resources";

describe("providerDocs", () => {
	const docs = providerDocs();

	test("writes the landing page and a page per resource and data source", () => {
		expect(Object.keys(docs)).toContain("index.md");
		for (const resource of IAC_RESOURCES) {
			expect(Object.keys(docs)).toContain(
				`resources/${resource.type.replace("homerun_", "")}.md`,
			);
		}
		for (const dataSource of IAC_DATA_SOURCES) {
			expect(Object.keys(docs)).toContain(
				`data-sources/${dataSource.type.replace("homerun_", "")}.md`,
			);
		}
	});

	test("gives every resource an example with its required attributes and nothing it doesn't have", () => {
		for (const resource of IAC_RESOURCES) {
			const example = RESOURCE_EXAMPLES[resource.type] ?? [];
			const known = new Set([
				...resource.attributes.map((attribute) => attribute.tf),
				...(resource.deployable ? ["deploy_on_change"] : []),
			]);
			const set = new Set(example.map(([name]) => name));
			expect(example.length, resource.type).toBeGreaterThan(0);
			expect(
				[...set].filter((name) => !known.has(name)),
				resource.type,
			).toEqual([]);
			expect(
				resource.attributes
					.filter((attribute) => attribute.required && !attribute.readOnly)
					.map((attribute) => attribute.tf)
					.filter((name) => !set.has(name)),
				resource.type,
			).toEqual([]);
		}
	});

	test("spells out what replaces a resource, what is sensitive and how to import it", () => {
		const bucket = docs["resources/bucket.md"] ?? "";
		expect(bucket).toContain(
			"- `store_id` (String) Changing it replaces the resource.",
		);
		expect(bucket).toContain('id = "<store_id>/<name>"');
		expect(docs["resources/object_store.md"]).toContain(
			"`secret_access_key` (String, Sensitive)",
		);
		expect(docs["resources/service.md"]).toContain("`deploy_on_change`");
		expect(docs["resources/status_page.md"]).toContain(
			"### Nested schema for `services`",
		);
	});

	test("lets a data source be picked by id or its lookup attribute", () => {
		expect(docs["data-sources/stack.md"]).toContain(
			"Set it, or `slug`, to pick the object.",
		);
	});
});
