import Bun from "bun";

const packages = ["cli", "installer", "agent"];
type CustomTarget = {
    name: "amd64" | "arm64";
    target: Bun.Build.CompileTarget;
};
const allTargets: CustomTarget[] = [
    {
        name: "arm64",
        target: "bun-linux-arm64",
    },
    {
        name: "amd64",
        target: "bun-linux-x64",
    },
];

// CI builds one arch per run, natively on a runner of that arch (see
// .github/workflows/binaries.yaml) rather than cross-compiling both targets
// from a single host : cross-compiling arm64 output on an amd64 runner (and
// vice versa) was the actual bug this arg exists to avoid. Pass "amd64" or
// "arm64" to build just that target; omit it (plain `bun run build:packages`,
// local dev) to build both, same as before.
const requestedArch = process.argv[2];
if (requestedArch && requestedArch !== "amd64" && requestedArch !== "arm64") {
    console.error(`Unknown target "${requestedArch}" : expected "amd64" or "arm64"`);
    process.exit(1);
}
const targets = requestedArch
    ? allTargets.filter((t) => t.name === requestedArch)
    : allTargets;
const totalBuilds = packages.length * targets.length;
const results = [];
const errors = [];

for (const packageName of packages) {
    console.log(`Building ${packageName}...`);
    for (const target of targets) {
        console.log(`  ==> ${target.name}...`);
        try {
            const res = await Bun.build({
                entrypoints: [`./packages/${packageName}/index.ts`],
                metafile: true,
                compile: {
                    target: target.target,
                    outfile: `dist/homerun-${packageName}-${target.name}`,
                },
                minify: true,
            });

            if (!res.success) {
                errors.push(res);
                continue;
            }

            if (!res.metafile) {
                errors.push("Failed to generate metafile.")
                continue;
            }

            for (const [path, input] of Object.entries(res.metafile.inputs)) {
                console.log(`${path}: ${input.bytes} bytes, ${input.imports.length} imports`);
            }

            // Analyze output files
            for (const [path, output] of Object.entries(res.metafile.outputs)) {
                console.log(`${path}: ${output.bytes} bytes`);
                for (const [inputPath, info] of Object.entries(output.inputs)) {
                    console.log(`  - ${inputPath}: ${info.bytesInOutput} bytes`);
                }
            }

            await Bun.write(`dist/homerun-${packageName}-metafile.json`, JSON.stringify(res.metafile));

            console.log("    ==> success");
            results.push(res);
        } catch (e) {
            errors.push(e);
        }
    }
}

function humanReadableSize(bytes: number): string {
    if (bytes === 0) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1,
    );
    const value = bytes / 1024 ** exponent;

    return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

if (results.length !== totalBuilds) {
    console.error("Some builds errored out.");
    console.error(`ERROR: Failed to build ${errors.length}/${totalBuilds} packages`);
    for (const err of errors) {
        console.error(err);
    }

    process.exit(1);
} else {
    for (const res of results) {
        for (const out of res.outputs) {
            console.info(`Built ${out.path} (${humanReadableSize(out.size)})`);
        }
    }
    console.log(`SUCCESS: Built ${results.length}/${totalBuilds} packages`);
}
