/**
 * Homerun's own vendored fork of `svelte-adapter-bun`
 * (https://github.com/gornostay25/svelte-adapter-bun), pulled in wholesale
 * rather than depended on via npm/git: upstream ships a compiled
 * `dist/index.js` that's gone unreleased for a while, so a fix here (or a
 * new `Bun.serve()` option) previously meant either forking-and-publishing
 * or string-patching the build output after the fact (see the now-removed
 * `scripts/patch-adapter-websocket.ts`). Owning the real TypeScript source
 * directly means a change here takes effect on the next `bun run build`,
 * no separate publish/rebuild step, and no npm/git dependency resolution at
 * all, just files in this repo.
 *
 * Structure mirrors upstream:
 * - `index.ts` (this file): the SvelteKit `Adapter`, run once at build time
 *   by `svelte.config.js` (`vite build` -> `adapt(builder)`).
 * - `templates/{index,handler,env}.ts`: the runtime entrypoint templates
 *   that become `build/{index,handler,env}.js`, the actual `Bun.serve()`
 *   process shipped to production. Upstream pre-compiles these once (its own
 *   `scripts/build.ts`) and ships the compiled output as part of the npm
 *   package; we compile them fresh on every `adapt()` call instead (see
 *   below), so there's nothing to keep in sync or re-publish.
 *
 * Deltas from upstream, both real, tested findings from running this app:
 * - `templates/handler.ts`'s `getHandler()` guards `server.websocket()`
 *   instead of calling it unconditionally. Upstream's own
 *   `patchServerWebsocketHandler()` (regex-grafting a `.websocket()`
 *   accessor onto @sveltejs/kit's generated `Server` class) is dropped
 *   entirely here rather than ported: verified it matches zero occurrences
 *   against our pinned `@sveltejs/kit@^2.70.3`, so `Server.websocket` never
 *   exists to call in the first place. This app has no websocket hook either
 *   way (see CLAUDE.md's Web terminal section), so there's no feature lost
 *   by treating a missing accessor as "no websocket support" rather than
 *   chasing a regex that doesn't match our Kit version.
 * - `serveOptions` (new `AdapterOptions` field): merged directly into the
 *   `Bun.serve()` call in `templates/index.ts`, for options Bun supports
 *   that this adapter has no dedicated field for (`tls`, `reusePort`,
 *   `maxConnections`, a custom `error` handler, new Bun 1.4 options, etc.)
 *   without needing a typed field added here per option.
 * - Static assets and prerendered pages are served entirely through Bun
 *   1.4's native `routes` support (see `templates/handler.ts`'s
 *   `buildStaticRoutes()`), not a JS-level static file server. Upstream (and
 *   this fork's own first pass) ran every request, static or not, through a
 *   hand-rolled `sirv`-based fetch handler; that's gone entirely now, along
 *   with the `mrmime`/`totalist` dependencies it needed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Adapter, Builder } from "@sveltejs/kit";
import { rolldown } from "rolldown";

export interface AdapterOptions {
	out?: string;
	/**
	 * Write pre-gzipped/pre-brotli'd `.gz`/`.br` sibling files alongside
	 * client assets and prerendered pages. Dead weight now that static
	 * serving goes through Bun 1.4's native `routes` (see
	 * `templates/handler.ts`): neither a `dir` route nor a bare `Bun.file()`
	 * route does Accept-Encoding content negotiation, nothing would ever
	 * pick these files up, they'd just become their own inert extra routes
	 * (`/foo.js.br` as a literal, separately-requestable path). Off by
	 * default for that reason; only turn on if something is added later that
	 * actually negotiates them.
	 * @default false
	 */
	precompress?: boolean;
	envPrefix?: string;
	/**
	 * If enabled, the adapter will serve static assets.
	 * @default true
	 */
	serveAssets?: boolean;
	/**
	 * Extra options merged into the `Bun.serve()` call (`tls`, `reusePort`,
	 * `maxConnections`, a custom `error` handler, ...). Applied *before* this
	 * adapter's own required fields (`idleTimeout`, `maxRequestBodySize`,
	 * `fetch`, `hostname`/`port`/`unix`, `websocket`), so it can't be used to
	 * override request handling, only to add to it. Use the existing env vars
	 * (`IDLE_TIMEOUT`, `BODY_SIZE_LIMIT`, `HOST`/`PORT`, `SOCKET_PATH`,
	 * `SHUTDOWN_TIMEOUT`) to change those instead.
	 * @default {}
	 */
	serveOptions?: Record<string, unknown>;
}

const templates = fileURLToPath(new URL("./templates", import.meta.url).href);

export default function adapter(options: AdapterOptions = {}): Adapter {
	const {
		out = "build",
		precompress = false,
		envPrefix = "",
		serveAssets = true,
		serveOptions = {},
	} = options;

	return {
		async adapt(builder: Builder) {
			const tmp = builder.getBuildDirectory("adapter-bun");

			builder.rimraf(out);
			builder.rimraf(tmp);
			builder.mkdirp(tmp);

			builder.log.minor("Copying assets");
			builder.writeClient(`${out}/client${builder.config.kit.paths.base}`);
			builder.writePrerendered(
				`${out}/prerendered${builder.config.kit.paths.base}`,
			);

			if (precompress) {
				builder.log.minor("Compressing assets");
				await Promise.all([
					builder.compress(`${out}/client`),
					builder.compress(`${out}/prerendered`),
				]);
			}

			builder.log.minor("Building server");
			builder.writeServer(tmp);
			writeFileSync(
				`${tmp}/manifest.js`,
				[
					`export const manifest = ${builder.generateManifest({ relativePath: "./" })};`,
					`export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});`,
					`export const base = ${JSON.stringify(builder.config.kit.paths.base)};`,
				].join("\n\n"),
			);

			const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
			const entrypoints: Record<string, string> = {
				index: `${tmp}/index.js`,
				manifest: `${tmp}/manifest.js`,
			};

			if (builder.hasServerInstrumentationFile?.()) {
				entrypoints["instrumentation.server"] =
					`${tmp}/instrumentation.server.js`;
			}

			const bundle = await rolldown({
				external: [
					...Object.keys(pkg.dependencies || {}).map(
						(d) => new RegExp(`^${d}(\\/.*)?$`),
					),
					/^node:/,
				],
				input: entrypoints,
			});

			await bundle.write({
				chunkFileNames: "chunks/[name]-[hash].js",
				dir: `${out}/server`,
				format: "esm",
				sourcemap: true,
			});

			// Compile our own entrypoint templates fresh, rather than shipping a
			// pre-built `files/` dir the way upstream's published package does :
			// there's nothing to publish here, so building on every adapt() keeps
			// templates/*.ts as the one source of truth, no separate build step to
			// remember to run first.
			builder.log.minor("Building entrypoint");
			await Bun.build({
				entrypoints: [
					`${templates}/index.ts`,
					`${templates}/handler.ts`,
					`${templates}/env.ts`,
				],
				// These are virtual module specifiers, not real packages, resolved by
				// the string replacement below (builder.copy's `replace` does a raw
				// token swap over the compiled output), so Bun.build must leave them
				// unresolved rather than erroring on a missing module.
				external: ["ENV", "MANIFEST", "SERVER", "HANDLER"],
				format: "esm",
				minify: false,
				outdir: `${tmp}/files`,
				target: "bun",
			});

			builder.copy(`${tmp}/files`, out, {
				replace: {
					BUILD_OPTIONS: JSON.stringify({ serveAssets }),
					ENV: "./env.js",
					ENV_PREFIX: JSON.stringify(envPrefix),
					HANDLER: "./handler.js",
					MANIFEST: "./server/manifest.js",
					SERVE_OPTIONS: JSON.stringify(serveOptions),
					SERVER: "./server/index.js",
				},
			});

			if (builder.hasServerInstrumentationFile?.()) {
				builder.instrument?.({
					entrypoint: `${out}/index.js`,
					instrumentation: `${out}/server/instrumentation.server.js`,
					module: {
						exports: ["path", "host", "port", "server"],
					},
				});
			}
		},
		name: "homerun-svelte-adapter-bun",
		supports: {
			instrumentation: () => true,
			read: () => true,
		},
	};
}
