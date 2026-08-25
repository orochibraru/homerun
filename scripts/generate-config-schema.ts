import { yamlConfigSchema } from "../src/lib/config";
import { z } from "zod";

function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (value !== null && typeof value === "object") {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

const schema = z.toJSONSchema(yamlConfigSchema, { target: "draft-7" });
await Bun.write(
	"homerun.schema.json",
	JSON.stringify(sortKeysDeep(schema), null, "\t"),
);

Bun.spawnSync(["bunx", "biome", "check", "--write", "homerun.schema.json"], {
	stderr: "inherit",
	stdout: "inherit",
});

console.log("Wrote homerun.schema.json");
