import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { providerDocs } from "../src/lib/iac/provider-docs";
import { iacSpec } from "../src/lib/iac/resources";

const target = "terraform/provider/internal/provider/spec.json";
const docsRoot = "terraform/provider/docs";

await Bun.write(target, `${JSON.stringify(iacSpec(), null, "\t")}\n`);
Bun.spawnSync(["bun", "fmt", target], {
	stderr: "inherit",
	stdout: "inherit",
});
console.log(`Wrote ${target}`);

await rm(docsRoot, { force: true, recursive: true });
for (const [path, content] of Object.entries(providerDocs())) {
	const file = join(docsRoot, path);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, content);
}
Bun.spawnSync(["bun", "fmt", docsRoot], {
	stderr: "inherit",
	stdout: "inherit",
});
console.log(`Wrote ${docsRoot}`);
