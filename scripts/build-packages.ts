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

interface Target {
	goarch: string;
	goos: string;
	name: TargetName;
	commands: string[];
}

const VERSION_FLAG = `-X github.com/orochibraru/homerun/internal/buildinfo.Version=${pkg.version}`;

// Every shipped binary is Go (cmd/cli, cmd/installer, cmd/agent), and Go's
// GOOS/GOARCH cross-compilation is exact, so all of them build from any one
// machine. Only the CLI gets macOS builds: the installer and the agent only ever
// run on the Linux host they manage.
const targets: Target[] = [
	{
		commands: ["cli", "installer", "agent"],
		goarch: "amd64",
		goos: "linux",
		name: "amd64",
	},
	{
		commands: ["cli", "installer", "agent"],
		goarch: "arm64",
		goos: "linux",
		name: "arm64",
	},
	{ commands: ["cli"], goarch: "amd64", goos: "darwin", name: "darwin-amd64" },
	{ commands: ["cli"], goarch: "arm64", goos: "darwin", name: "darwin-arm64" },
];

const requested = process.argv.slice(2).flatMap((arg) => arg.split(/[\s,]+/));
for (const name of requested) {
	if (!TARGET_NAMES.includes(name as TargetName)) {
		console.error(
			`Unknown target "${name}" : expected one of ${TARGET_NAMES.join(", ")}`,
		);
		process.exit(1);
	}
}
const selected = targets.filter(
	(target) => requested.length === 0 || requested.includes(target.name),
);

/**
 * Compiles one command for one target. `-s -w` drops the symbol table and DWARF
 * debug info, `-trimpath` keeps build paths out of the binary, CGO is off so the
 * binary is static and runs on a musl host like Alpine too, and the release
 * version is stamped into internal/buildinfo so every binary reports the same one.
 *
 * @returns The output path, or the compiler's error output on failure.
 */
async function build(
	target: Target,
	command: string,
): Promise<{ error?: string; outfile: string }> {
	const outfile = `dist/homerun-${command}-${target.name}`;
	const proc = Bun.spawn(
		[
			"go",
			"build",
			"-trimpath",
			"-ldflags",
			`-s -w ${VERSION_FLAG}`,
			"-o",
			outfile,
			`./cmd/${command}`,
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
	return code === 0 ? { outfile } : { error: stderr.trim(), outfile };
}

function humanReadableSize(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

const failures: string[] = [];
const built: string[] = [];
for (const target of selected) {
	console.log(`Building ${target.name}...`);
	for (const command of target.commands) {
		const result = await build(target, command);
		if (result.error) {
			failures.push(`${result.outfile}: ${result.error}`);
		} else {
			built.push(result.outfile);
			console.log(
				`  ${result.outfile} (${humanReadableSize(Bun.file(result.outfile).size)})`,
			);
		}
	}
}

if (failures.length > 0) {
	console.error(`ERROR: ${failures.length} build(s) failed:`);
	for (const failure of failures) {
		console.error(failure);
	}
	process.exit(1);
}
console.log(`SUCCESS: Built ${built.length} binaries`);
