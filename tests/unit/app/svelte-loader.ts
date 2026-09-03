import { afterEach, beforeEach, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { compile, compileModule } from "svelte/compiler";

const require = createRequire(import.meta.url);
// "svelte/src/index-client.js" isn't itself a declared subpath export (the
// package's "exports" map has no wildcard), so resolve the package root via
// its own package.json and join the internal path onto that.
const svelteClientEntry = join(
	dirname(require.resolve("svelte/package.json")),
	"src/index-client.js",
);

// `svelte`'s package.json only exposes its browser/DOM build (the one every
// compiled component and @testing-library/svelte's own internals need, since
// they `mount()` into a real DOM) under the "browser" export condition, which
// bundlers like Vite set and Bun's test runner does not : left alone, a bare
// `import ... from "svelte"` resolves to the SSR build instead, and
// `mount()` throws `lifecycle_function_unavailable` the moment a component
// actually renders (verified live). A `Bun.plugin` `onResolve` redirect was
// tried first and doesn't work here : `args.path` in a `bun test` process is
// already the fully-resolved SSR entry point by the time the hook runs
// (verified with a logging hook, no fewer than zero hits), and even matching
// on that resolved path never fired inside the actual `bun:test` run despite
// firing in a standalone `bun run` script, some difference in how `bun test`
// wires plugin resolution wasn't tracked down further. `mock.module`, this
// suite's existing process-global module-remapping tool (see
// tests/README.md's "Mocks are process-global"), works reliably instead.
mock.module("svelte", async () => await import(svelteClientEntry));

beforeEach(async () => {
	GlobalRegistrator.register();
});

afterEach(async () => {
	await GlobalRegistrator.unregister();
});

/** Strips a bundler-added `?query` suffix (Bun/Vite-style cache-busting import params) before reading the file back off disk. */
function bareFilePath(path: string): string {
	return path.slice(0, path.includes("?") ? path.indexOf("?") : path.length);
}

plugin({
	name: "svelte loader",
	setup(builder) {
		// Real `.svelte` components: markup + script, compiled with `compile()`.
		builder.onLoad(
			{ filter: /(?<!\.svelte\.(js|ts))\.svelte(\?[^.]+)?$/ },
			({ path }) => {
				try {
					const source = readFileSync(bareFilePath(path), "utf-8");
					const result = compile(source, {
						dev: false,
						filename: path,
						generate: "client",
					});
					return { contents: result.js.code, loader: "js" };
				} catch (err) {
					if (err instanceof Error) {
						throw new Error(
							`Failed to compile Svelte component: ${err.message}`,
						);
					}
					throw new Error(`Failed to compile Svelte component: ${String(err)}`);
				}
			},
		);

		// Svelte 5's rune-only-module convention (`*.svelte.js`/`*.svelte.ts`,
		// runes with no markup): needs `compileModule()`, a different compiler
		// entry point, not `compile()`. Load-bearing for component tests at all:
		// `@testing-library/svelte`'s own internals (`props.svelte.js`) are
		// shipped as one of these, uncompiled ones throw `rune_outside_svelte`
		// the moment `render()` touches a `$state` rune, since Bun's default JS
		// loader has no idea those are runes rather than plain identifiers.
		builder.onLoad({ filter: /\.svelte\.(js|ts)(\?[^.]+)?$/ }, ({ path }) => {
			try {
				const source = readFileSync(bareFilePath(path), "utf-8");
				const result = compileModule(source, { filename: path });
				return { contents: result.js.code, loader: "js" };
			} catch (err) {
				if (err instanceof Error) {
					throw new Error(`Failed to compile Svelte module: ${err.message}`);
				}
				throw new Error(`Failed to compile Svelte module: ${String(err)}`);
			}
		});
	},
});
