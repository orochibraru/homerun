import { iacSpec } from "../src/lib/iac/resources";

const target = "terraform/provider/internal/provider/spec.json";

await Bun.write(target, `${JSON.stringify(iacSpec(), null, "\t")}\n`);
Bun.spawnSync(["bunx", "biome", "check", "--write", target], {
	stderr: "inherit",
	stdout: "inherit",
});

console.log(`Wrote ${target}`);
