import { createHash } from "node:crypto";

import { config } from "#lib/config.js";
import type { PackageRegistryKind } from "#lib/package-registries.js";

import { certResolverFor } from "./cert-resolver.ts";
import { MIRROR_LABEL } from "./image-scan-refs.ts";

/** How one package registry's container is built: its image, where its files live, and what it listens on. */
export interface PackageRegistrySpec {
	cmd: string[] | null;
	configDir: string;
	configFiles: Record<string, string>;
	configOwner: string;
	containerName: string;
	dataDir: string;
	image: string;
	port: number;
	publicUrlEnv: string | null;
	tag: string;
}

/** How a package registry's container should currently be configured. */
export interface PackageRegistryDesiredState {
	htpasswd: string;
	publicHost: string | null;
}

/** What a running container is compared on. */
export interface PackageRegistryContainer {
	env: string[];
	image: string | undefined;
	labels: Record<string, string>;
}

export const PACKAGE_REGISTRY_HTPASSWD = "htpasswd";

const CONFIG_DIGEST_ENV = "HOMERUN_PACKAGE_REGISTRY_CONFIG";
const VERDACCIO_CONFIG_DIR = "/verdaccio/conf";
const PYPI_AUTH_DIR = "/data/auth";

/**
 * Verdaccio's config: htpasswd auth with sign-up turned off, so only the
 * tokens Homerun writes get in, every package readable and publishable by
 * them alone, and npmjs.org as the uplink for whatever isn't published here.
 */
export function verdaccioConfig(): string {
	const packageRule = [
		"    access: $authenticated",
		"    publish: $authenticated",
		"    unpublish: $authenticated",
		"    proxy: npmjs",
	];
	return [
		"storage: /verdaccio/storage/data",
		"plugins: /verdaccio/plugins",
		"web:",
		"  title: Homerun npm",
		"auth:",
		"  htpasswd:",
		`    file: ${VERDACCIO_CONFIG_DIR}/${PACKAGE_REGISTRY_HTPASSWD}`,
		"    max_users: -1",
		"uplinks:",
		"  npmjs:",
		"    url: https://registry.npmjs.org/",
		"packages:",
		"  '@*/*':",
		...packageRule,
		"  '**':",
		...packageRule,
		"server:",
		"  keepAliveTimeout: 60",
		"max_body_size: 200mb",
		"log:",
		"  type: stdout",
		"  format: pretty",
		"  level: http",
		"",
	].join("\n");
}

export const PACKAGE_REGISTRY_SPECS: Record<
	PackageRegistryKind,
	PackageRegistrySpec
> = {
	npm: {
		cmd: null,
		configDir: VERDACCIO_CONFIG_DIR,
		configFiles: { "config.yaml": verdaccioConfig() },
		configOwner: "10001:0",
		containerName: "homerun-npm",
		dataDir: "/verdaccio/storage",
		image: "verdaccio/verdaccio",
		port: 4873,
		publicUrlEnv: "VERDACCIO_PUBLIC_URL",
		tag: "6.11.1",
	},
	pypi: {
		cmd: [
			"run",
			"-p",
			"8080",
			"--server",
			"gunicorn",
			"-P",
			`${PYPI_AUTH_DIR}/${PACKAGE_REGISTRY_HTPASSWD}`,
			"-a",
			"update,download,list",
			"/data/packages",
		],
		configDir: PYPI_AUTH_DIR,
		configFiles: {},
		configOwner: "9898:9898",
		containerName: "homerun-pypi",
		dataDir: "/data/packages",
		image: "pypiserver/pypiserver",
		port: 8080,
		publicUrlEnv: null,
		tag: "v2.4.2",
	},
};

/** The named volume holding a package registry's packages, kept when it's turned off. */
export function packageRegistryDataVolume(kind: PackageRegistryKind): string {
	return `${PACKAGE_REGISTRY_SPECS[kind].containerName}-data`;
}

/** The named volume holding a package registry's config and htpasswd file. */
export function packageRegistryConfigVolume(kind: PackageRegistryKind): string {
	return `${PACKAGE_REGISTRY_SPECS[kind].containerName}-config`;
}

/** The address services on the shared network reach a package registry at. */
export function packageRegistryInternalUrl(kind: PackageRegistryKind): string {
	const spec = PACKAGE_REGISTRY_SPECS[kind];
	return `http://${spec.containerName}:${spec.port}/`;
}

/**
 * The shell script a one-off container runs to write the registry's config
 * files and htpasswd into its config volume, then hand them to the user the
 * registry runs as. The contents come in as environment variables, see
 * `packageRegistryFileEnv`.
 */
export function packageRegistryFileScript(kind: PackageRegistryKind): string {
	const spec = PACKAGE_REGISTRY_SPECS[kind];
	const writes = [
		...Object.keys(spec.configFiles),
		PACKAGE_REGISTRY_HTPASSWD,
	].map(
		(name, index) => `printf '%s' "$FILE_${index}" > ${spec.configDir}/${name}`,
	);
	return [
		`mkdir -p ${spec.configDir}`,
		...writes,
		`chown -R ${spec.configOwner} ${spec.configDir}`,
	].join(" && ");
}

/** The environment `packageRegistryFileScript` reads each file's content from, in the same order. */
export function packageRegistryFileEnv(
	kind: PackageRegistryKind,
	htpasswd: string,
): Record<string, string> {
	const contents = [
		...Object.values(PACKAGE_REGISTRY_SPECS[kind].configFiles),
		htpasswd ? `${htpasswd}\n` : "",
	];
	return Object.fromEntries(
		contents.map((content, index) => [`FILE_${index}`, content]),
	);
}

/**
 * The container's environment: a digest of its config files and command, so
 * a container started from older ones no longer matches and is recreated,
 * plus the public URL a registry builds its links from, when it's published.
 */
export function packageRegistryEnv(
	kind: PackageRegistryKind,
	state: PackageRegistryDesiredState,
): string[] {
	const spec = PACKAGE_REGISTRY_SPECS[kind];
	const digest = createHash("sha256")
		.update(JSON.stringify([spec.configFiles, spec.cmd]))
		.digest("hex")
		.slice(0, 16);
	const env = [`${CONFIG_DIGEST_ENV}=${digest}`];
	if (spec.publicUrlEnv && state.publicHost) {
		env.push(`${spec.publicUrlEnv}=https://${state.publicHost}/`);
	}
	return env;
}

/**
 * The container's labels: its infra marker, plus a Traefik router when it's
 * published at a hostname. Uploads stream through without a buffering
 * middleware, like the Docker registry's pushes.
 */
export function packageRegistryLabels(
	kind: PackageRegistryKind,
	state: PackageRegistryDesiredState,
): Record<string, string> {
	const spec = PACKAGE_REGISTRY_SPECS[kind];
	const router = spec.containerName;
	const labels: Record<string, string> = {
		[MIRROR_LABEL]: `${kind}-registry`,
	};
	if (!state.publicHost) {
		return labels;
	}
	const resolver = certResolverFor(
		state.publicHost,
		config.traefik.certResolver,
		config.pangolinEnabled,
		config.traefik.instanceCertNames,
	);
	labels["traefik.enable"] = "true";
	labels[`traefik.http.routers.${router}.rule`] =
		`Host(\`${state.publicHost}\`)`;
	labels[`traefik.http.routers.${router}.entrypoints`] =
		config.traefik.entrypoint;
	labels[`traefik.http.routers.${router}.service`] = router;
	labels[`traefik.http.services.${router}.loadbalancer.server.port`] = String(
		spec.port,
	);
	labels[`traefik.http.routers.${router}.tls`] = "true";
	if (resolver) {
		labels[`traefik.http.routers.${router}.tls.certresolver`] = resolver;
	}
	return labels;
}

/**
 * Whether a container already runs the pinned image with `state`'s
 * environment and Traefik labels, so it can be left alone. A public URL left
 * over from a removed hostname counts as a mismatch; anything else Docker
 * adds to the env or labels is ignored.
 */
export function packageRegistryMatches(
	kind: PackageRegistryKind,
	container: PackageRegistryContainer,
	state: PackageRegistryDesiredState,
): boolean {
	const { env, labels } = container;
	const spec = PACKAGE_REGISTRY_SPECS[kind];
	if (container.image !== `${spec.image}:${spec.tag}`) {
		return false;
	}
	const wantedEnv = packageRegistryEnv(kind, state);
	if (!wantedEnv.every((entry) => env.includes(entry))) {
		return false;
	}
	const publicUrlEnv = spec.publicUrlEnv;
	if (
		publicUrlEnv &&
		env.some(
			(entry) =>
				entry.startsWith(`${publicUrlEnv}=`) && !wantedEnv.includes(entry),
		)
	) {
		return false;
	}
	const wantedLabels = packageRegistryLabels(kind, state);
	const traefikKeys = new Set(
		[...Object.keys(labels), ...Object.keys(wantedLabels)].filter((key) =>
			key.startsWith("traefik."),
		),
	);
	return [...traefikKeys].every((key) => labels[key] === wantedLabels[key]);
}
