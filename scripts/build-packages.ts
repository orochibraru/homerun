import process from "node:process";
import Bun from "bun";
import pkg from "../package.json" with { type: "json" };

const TARGET_NAMES = [
	"amd64",
	"arm64",
	"darwin-amd64",
	"darwin-arm64",
] as const;
type TargetName = (typeof TARGET_NAMES)[number];

interface BunTarget {
	name: TargetName;
	packages: string[];
	target: Bun.Build.CompileTarget;
}

interface GoTarget {
	goarch: string;
	goos: string;
	name: TargetName;
	packages: string[];
}

// The agent is still a Bun program, and a Bun binary embeds the whole runtime
// (~81MB on linux/x64, of which ~1MB is ours), so it's only built for the Linux
// hosts that actually run it.
const bunTargets: BunTarget[] = [
	{
		name: "arm64",
		packages: ["agent"],
		target: "bun-linux-arm64",
	},
	{
		name: "amd64",
		packages: ["agent"],
		target: "bun-linux-x64",
	},
];

// The CLI and installer are Go: ~6MB and ~4MB instead of ~81MB each, and
// cross-compiling is exact, so every target builds from whichever runner CI
// happens to use. The installer only ever runs on the Linux box it's
// installing, so it gets no darwin build.
const goTargets: GoTarget[] = [
	{
		goarch: "amd64",
		goos: "linux",
		name: "amd64",
		packages: ["cli", "installer"],
	},
	{
		goarch: "arm64",
		goos: "linux",
		name: "arm64",
		packages: ["cli", "installer"],
	},
	{
		goarch: "amd64",
		goos: "darwin",
		name: "darwin-amd64",
		packages: ["cli"],
	},
	{
		goarch: "arm64",
		goos: "darwin",
		name: "darwin-arm64",
		packages: ["cli"],
	},
];

// CI builds one arch per run, natively on a runner of that arch (see
// .github/workflows/binaries.yaml) rather than cross-compiling both targets
// from a single host : cross-compiling arm64 *Bun* output on an amd64 runner
// (and vice versa) was the actual bug this arg exists to avoid. Go is exempt,
// `GOOS`/`GOARCH` cross-compilation is exact, so the Go binaries below build
// from any runner. Pass a target name to build just that one; omit it (plain
// `bun run build:packages`, local dev) to build them all.
const requested = process.argv.slice(2).flatMap((arg) => arg.split(/[\s,]+/));
for (const name of requested) {
	if (!TARGET_NAMES.includes(name as TargetName)) {
		console.error(
			`Unknown target "${name}" : expected one of ${TARGET_NAMES.join(", ")}`,
		);
		process.exit(1);
	}
}
const wanted = (name: TargetName) =>
	requested.length === 0 || requested.includes(name);
const selectedBunTargets = bunTargets.filter((t) => wanted(t.name));
const selectedGoTargets = goTargets.filter((t) => wanted(t.name));
const totalBuilds =
	selectedBunTargets.reduce((n, t) => n + t.packages.length, 0) +
	selectedGoTargets.reduce((n, t) => n + t.packages.length, 0);
const built: string[] = [];
const errors: unknown[] = [];

/**
 * Compiles one Go package for one target. `-s -w` drops the symbol table and
 * DWARF debug info, `-trimpath` keeps build paths out of the binary, and
 * `main.version` is stamped from the root package.json so there's one version
 * for the whole repo and no file read at runtime.
 */
async function buildGo(
	target: GoTarget,
	packageName: string,
): Promise<string | null> {
	const outfile = `dist/homerun-${packageName}-${target.name}`;
	const proc = Bun.spawn(
		[
			"go",
			"build",
			"-trimpath",
			"-ldflags",
			`-s -w -X main.version=${pkg.version}`,
			"-o",
			outfile,
			`./packages/${packageName}`,
		],
		{
			env: {
				...process.env,
				CGO_ENABLED: "0",
				GOARCH: target.goarch,
				GOOS: target.goos,
			},
			stderr: "pipe",
			stdout: "inherit",
		},
	);
	const [stderr, code] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		errors.push(`go build ${packageName} (${target.name}): ${stderr.trim()}`);
		return null;
	}
	return outfile;
}

/** Compiles one Bun package for one target into a standalone binary. */
async function buildBun(
	target: BunTarget,
	packageName: string,
): Promise<string | null> {
	const outfile = `dist/homerun-${packageName}-${target.name}`;
	try {
		const res = await Bun.build({
			entrypoints: [`./packages/${packageName}/index.ts`],
			compile: {
				target: target.target,
				outfile,
			},
			minify: true,
		});
		if (!res.success) {
			errors.push(res);
			return null;
		}
		return outfile;
	} catch (e) {
		errors.push(e);
		return null;
	}
}

for (const target of selectedGoTargets) {
	console.log(`Building ${target.name} (go)...`);
	for (const packageName of target.packages) {
		console.log(`  ==> ${packageName}...`);
		const outfile = await buildGo(target, packageName);
		if (outfile) {
			built.push(outfile);
		}
	}
}

for (const target of selectedBunTargets) {
	console.log(`Building ${target.name} (bun)...`);
	for (const packageName of target.packages) {
		console.log(`  ==> ${packageName}...`);
		const outfile = await buildBun(target, packageName);
		if (outfile) {
			built.push(outfile);
		}
	}
}

function humanReadableSize(bytes: number): string {
	if (bytes === 0) {
		return "0 B";
	}

	const units = ["B", "KB", "MB", "GB", "TB"];
	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	const value = bytes / 1024 ** exponent;

	return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

if (built.length !== totalBuilds) {
	console.error("Some builds errored out.");
	console.error(
		`ERROR: Failed to build ${errors.length}/${totalBuilds} packages`,
	);
	for (const err of errors) {
		console.error(err);
	}

	process.exit(1);
}

for (const outfile of built) {
	console.info(
		`Built ${outfile} (${humanReadableSize(Bun.file(outfile).size)})`,
	);
}
console.log(`SUCCESS: Built ${built.length}/${totalBuilds} packages`);
