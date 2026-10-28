import type { BuildMethod } from "#lib/build-methods.js";
import type { DetectedConfig } from "#lib/image-config.js";

export interface RepoSniff {
	method: BuildMethod;
	name: string | null;
	port: number | null;
	reason: string;
	runtime: string;
}

const BAKE_FILES = ["docker-bake.hcl", "docker-bake.json"];

const RUNTIMES: [string, string][] = [
	["package.json", "Node.js"],
	["deno.json", "Deno"],
	["deno.jsonc", "Deno"],
	["go.mod", "Go"],
	["Cargo.toml", "Rust"],
	["pyproject.toml", "Python"],
	["requirements.txt", "Python"],
	["Pipfile", "Python"],
	["Gemfile", "Ruby"],
	["composer.json", "PHP"],
	["pom.xml", "Java"],
	["build.gradle", "Java"],
	["build.gradle.kts", "Kotlin"],
	["mix.exs", "Elixir"],
	["index.html", "Static site"],
];

const NODE_FRAMEWORKS: [string, string, number | null][] = [
	["next", "Next.js", 3000],
	["nuxt", "Nuxt", 3000],
	["@sveltejs/kit", "SvelteKit", 3000],
	["@remix-run/node", "Remix", 3000],
	["@react-router/node", "React Router", 3000],
	["astro", "Astro", 4321],
	["@nestjs/core", "NestJS", 3000],
	["@adonisjs/core", "AdonisJS", 3333],
	["fastify", "Fastify", null],
	["express", "Express", null],
	["hono", "Hono", null],
	["vite", "Vite", null],
];

const GO_FRAMEWORKS: [string, string][] = [
	["github.com/gin-gonic/gin", "Gin"],
	["github.com/labstack/echo", "Echo"],
	["github.com/gofiber/fiber", "Fiber"],
	["github.com/go-chi/chi", "chi"],
];

const PYTHON_FRAMEWORKS: [RegExp, string, number | null][] = [
	[/\bdjango\b/i, "Django", 8000],
	[/\bfastapi\b/i, "FastAPI", 8000],
	[/\bflask\b/i, "Flask", 5000],
	[/\bstreamlit\b/i, "Streamlit", 8501],
];

const GO_MODULE_RE = /^module\s+(\S+)/m;

/** The file names `sniffRepo` understands, bake files first, in the order they win. */
export const REPO_MARKERS: string[] = [
	...BAKE_FILES,
	...RUNTIMES.map(([file]) => file),
];

/** `package.json`'s name and the first framework among its dependencies. */
function sniffNode(content: string): {
	framework: [string, number | null] | null;
	name: string | null;
} {
	let pkg: {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		name?: unknown;
	};
	try {
		pkg = JSON.parse(content);
	} catch {
		return { framework: null, name: null };
	}
	const deps = { ...pkg.devDependencies, ...pkg.dependencies };
	const found = NODE_FRAMEWORKS.find(([dep]) => dep in deps);
	const name =
		typeof pkg.name === "string" ? pkg.name.replace(/^@[^/]+\//, "") : null;
	return { framework: found ? [found[1], found[2]] : null, name };
}

/** The framework a Go module or a Python dependency file names, with its usual port. */
function sniffFramework(
	runtime: string,
	content: string,
): [string, number | null] | null {
	if (runtime === "Go") {
		const found = GO_FRAMEWORKS.find(([path]) => content.includes(path));
		return found ? [found[1], null] : null;
	}
	if (runtime === "Python") {
		const found = PYTHON_FRAMEWORKS.find(([pattern]) => pattern.test(content));
		return found ? [found[1], found[2]] : null;
	}
	return null;
}

/**
 * What a repository without a Dockerfile most likely is, from the first
 * marker file found in it (`REPO_MARKERS` order): a Bake file builds with
 * Bake, anything else with Railpack, labelled with its language and, when a
 * dependency gives it away, its framework and the port it listens on by
 * default.
 *
 * @returns null when `path` isn't a marker this knows.
 */
export function sniffRepo(path: string, content: string): RepoSniff | null {
	const file = path.split("/").pop() ?? path;
	if (BAKE_FILES.includes(file)) {
		return {
			method: "bake",
			name: null,
			port: null,
			reason: `${file} found, no Dockerfile`,
			runtime: "Docker Bake",
		};
	}
	const runtime = RUNTIMES.find(([marker]) => marker === file)?.[1];
	if (!runtime) {
		return null;
	}
	const node = runtime === "Node.js" ? sniffNode(content) : null;
	const framework = node ? node.framework : sniffFramework(runtime, content);
	const goModule = runtime === "Go" ? GO_MODULE_RE.exec(content)?.[1] : null;
	return {
		method: "railpack",
		name: node?.name ?? goModule?.split("/").pop() ?? null,
		port: framework?.[1] ?? null,
		reason: `${file} found, no Dockerfile`,
		runtime: framework ? `${runtime} (${framework[0]})` : runtime,
	};
}

/**
 * Folds what `sniffRepo` found into `config`: the build method and runtime,
 * the framework's port when nothing else declared one, and the project's
 * name when nothing else suggested one.
 */
export function withSniff(
	config: DetectedConfig,
	sniff: RepoSniff,
	suggestMethod: boolean,
): DetectedConfig {
	const next: DetectedConfig = {
		...config,
		build: suggestMethod
			? { method: sniff.method, reason: sniff.reason }
			: config.build,
		ports: [...config.ports],
		prefill: { ...config.prefill },
		runtime: sniff.runtime,
	};
	if (next.ports.length === 0 && sniff.port) {
		next.ports.push({ port: sniff.port, protocol: "tcp" });
	}
	if (!next.prefill.name && sniff.name) {
		next.prefill.name = sniff.name;
	}
	return next;
}
