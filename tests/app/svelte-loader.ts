import { afterEach, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { compile } from "svelte/compiler";

beforeEach(async () => {
	GlobalRegistrator.register();
});

afterEach(async () => {
	await GlobalRegistrator.unregister();
});

plugin({
	name: "svelte loader",
	setup(builder) {
		builder.onLoad({ filter: /\.svelte(\?[^.]+)?$/ }, ({ path }) => {
			try {
				const source = readFileSync(
					path.substring(
						0,
						path.includes("?") ? path.indexOf("?") : path.length,
					),
					"utf-8",
				);

				const result = compile(source, {
					dev: false,
					filename: path,
					generate: "client",
				});

				return {
					contents: result.js.code,
					loader: "js",
				};
			} catch (err) {
				if (err instanceof Error) {
					throw new Error(`Failed to compile Svelte component: ${err.message}`);
				}
				throw new Error(`Failed to compile Svelte component: ${String(err)}`);
			}
		});
	},
});
