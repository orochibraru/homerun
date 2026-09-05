import { parse as parseYaml } from "yaml";

export type ComposeRestartPolicy =
	| "no"
	| "always"
	| "on-failure"
	| "unless-stopped";

export interface ComposeVolumeDraft {
	containerPath: string;
	kind: "bind" | "volume";
	name: string;
	readOnly: boolean;
	source: string;
}

export interface ComposeServiceDraft {
	containerPort: number;
	cpuLimit: string | null;
	dependsOn: string[];
	dnsResolvable: boolean;
	envVars: Record<string, string>;
	image: string;
	key: string;
	memoryLimitMb: number | null;
	name: string;
	networkMode: "bridge" | "host";
	portProtocol: "tcp" | "udp" | "both";
	restartPolicy: ComposeRestartPolicy;
	slug: string;
	tag: string;
	volumes: ComposeVolumeDraft[];
	warnings: string[];
}

export interface ComposeImportPlan {
	networkNames: string[];
	services: ComposeServiceDraft[];
	volumeNames: string[];
	warnings: string[];
}

export class ComposeParseError extends Error {}

const DEFAULT_CONTAINER_PORT = 80;

const UNSUPPORTED_KEYS: Record<string, string> = {
	cap_add: "added capabilities are not applied",
	cap_drop: "dropped capabilities are not applied",
	command: "a custom command is not applied : bake it into the image instead",
	devices: "device mappings are not applied",
	entrypoint: "a custom entrypoint is not applied",
	env_file: "env_file is not read : paste the values as variables instead",
	extra_hosts: "extra_hosts entries are not applied",
	healthcheck: "healthchecks are not applied",
	labels: "custom labels are not applied",
	privileged: "privileged mode is not applied",
	secrets: "secrets are not applied",
	sysctls: "sysctls are not applied",
	tmpfs: "tmpfs mounts are not applied",
	user: "a custom user is not applied",
};

export function slugifyComposeKey(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function splitImageRef(ref: string): { image: string; tag: string } {
	const withoutDigest = ref.split("@")[0] ?? ref;
	const lastColon = withoutDigest.lastIndexOf(":");
	const lastSlash = withoutDigest.lastIndexOf("/");
	if (lastColon === -1 || lastColon < lastSlash) {
		return { image: withoutDigest, tag: "latest" };
	}
	return {
		image: withoutDigest.slice(0, lastColon),
		tag: withoutDigest.slice(lastColon + 1) || "latest",
	};
}

function parseEnvironment(raw: unknown): Record<string, string> {
	const env: Record<string, string> = {};
	if (Array.isArray(raw)) {
		for (const entry of raw) {
			const line = String(entry);
			const eq = line.indexOf("=");
			if (eq > 0) {
				env[line.slice(0, eq).trim()] = line.slice(eq + 1);
			}
		}
		return env;
	}
	if (isRecord(raw)) {
		for (const [key, value] of Object.entries(raw)) {
			env[key] = value === null || value === undefined ? "" : String(value);
		}
	}
	return env;
}

interface PortMapping {
	port: number;
	protocol: "tcp" | "udp";
}

function parsePortEntry(raw: unknown): PortMapping | null {
	if (typeof raw === "number") {
		return { port: raw, protocol: "tcp" };
	}
	if (isRecord(raw)) {
		const target = Number(raw.target);
		if (Number.isInteger(target) && target > 0) {
			return {
				port: target,
				protocol: raw.protocol === "udp" ? "udp" : "tcp",
			};
		}
		return null;
	}
	if (typeof raw !== "string") {
		return null;
	}

	const [spec, rawProtocol] = raw.split("/");
	const protocol = rawProtocol === "udp" ? "udp" : "tcp";
	const parts = (spec ?? "").split(":");
	const containerSide = parts[parts.length - 1] ?? "";
	const port = Number(containerSide.split("-")[0]);
	return Number.isInteger(port) && port > 0 ? { port, protocol } : null;
}

function protocolFor(mappings: PortMapping[]): "tcp" | "udp" | "both" {
	const hasTcp = mappings.some((m) => m.protocol === "tcp");
	const hasUdp = mappings.some((m) => m.protocol === "udp");
	if (hasTcp && hasUdp) {
		return "both";
	}
	return hasUdp ? "udp" : "tcp";
}

function parseMemoryLimit(raw: unknown): number | null {
	if (typeof raw === "number") {
		return Math.round(raw / (1024 * 1024)) || null;
	}
	if (typeof raw !== "string") {
		return null;
	}
	const match = /^(\d+(?:\.\d+)?)\s*([kmgb]?b?)$/i.exec(raw.trim());
	if (!match) {
		return null;
	}
	const amount = Number(match[1]);
	const unit = (match[2] ?? "").toLowerCase();
	const bytes = unit.startsWith("g")
		? amount * 1024 * 1024 * 1024
		: unit.startsWith("m")
			? amount * 1024 * 1024
			: unit.startsWith("k")
				? amount * 1024
				: amount;
	const mb = Math.round(bytes / (1024 * 1024));
	return mb > 0 ? mb : null;
}

function parseRestart(raw: unknown): ComposeRestartPolicy {
	const value = typeof raw === "string" ? raw.split(":")[0] : "";
	switch (value) {
		case "always":
			return "always";
		case "no":
			return "no";
		case "on-failure":
			return "on-failure";
		case "unless-stopped":
			return "unless-stopped";
		default:
			return "unless-stopped";
	}
}

function parseDependsOn(raw: unknown): string[] {
	if (Array.isArray(raw)) {
		return raw.map(String);
	}
	if (isRecord(raw)) {
		return Object.keys(raw);
	}
	return [];
}

function volumeNameFor(serviceSlug: string, containerPath: string): string {
	const suffix = slugifyComposeKey(containerPath.replace(/^\//, "")) || "data";
	return `${serviceSlug}-${suffix}`.slice(0, 63);
}

function parseLongVolume(
	raw: Record<string, unknown>,
	serviceSlug: string,
	warnings: string[],
): ComposeVolumeDraft | null {
	const type = String(raw.type ?? "volume");
	const source = raw.source === undefined ? "" : String(raw.source);
	const target = raw.target === undefined ? "" : String(raw.target);
	if (!(source && target) || (type !== "bind" && type !== "volume")) {
		warnings.push(`Skipped an unsupported "${type}" mount.`);
		return null;
	}
	return {
		containerPath: target,
		kind: type,
		name: type === "volume" ? source : volumeNameFor(serviceSlug, target),
		readOnly: raw.read_only === true,
		source,
	};
}

function parseShortVolume(
	raw: string,
	serviceSlug: string,
	warnings: string[],
): ComposeVolumeDraft | null {
	const [source, containerPath, mode] = raw.split(":");
	if (!(source && containerPath)) {
		warnings.push(
			`Skipped the anonymous volume "${raw}" : give it a name or a host path.`,
		);
		return null;
	}

	const isPath = source.startsWith("/") || source.startsWith("~");
	if (!(isPath || /^[A-Za-z0-9][\w.-]*$/.test(source))) {
		warnings.push(
			`Skipped the relative bind mount "${source}" : Homerun needs an absolute host path.`,
		);
		return null;
	}

	return {
		containerPath,
		kind: isPath ? "bind" : "volume",
		name: isPath ? volumeNameFor(serviceSlug, containerPath) : source,
		readOnly: mode === "ro",
		source,
	};
}

function parseVolumeEntry(
	raw: unknown,
	serviceSlug: string,
	warnings: string[],
): ComposeVolumeDraft | null {
	if (isRecord(raw)) {
		return parseLongVolume(raw, serviceSlug, warnings);
	}
	if (typeof raw !== "string") {
		return null;
	}
	return parseShortVolume(raw, serviceSlug, warnings);
}

function uniqueSlug(key: string, name: string, usedSlugs: Set<string>): string {
	let slug = slugifyComposeKey(name) || slugifyComposeKey(key) || "service";
	let attempt = 2;
	while (usedSlugs.has(slug)) {
		slug = `${slug.slice(0, 60)}-${attempt}`;
		attempt += 1;
	}
	usedSlugs.add(slug);
	return slug;
}

function unsupportedWarnings(raw: Record<string, unknown>): string[] {
	const warnings: string[] = [];
	if (raw.build !== undefined) {
		warnings.push(
			"Built from a local Dockerfile : point it at a git repository on the Source tab after importing.",
		);
	}
	for (const [composeKey, message] of Object.entries(UNSUPPORTED_KEYS)) {
		if (raw[composeKey] !== undefined) {
			warnings.push(`${composeKey}: ${message}.`);
		}
	}
	return warnings;
}

function portsFor(
	raw: Record<string, unknown>,
	warnings: string[],
): { mappings: PortMapping[]; published: boolean } {
	const portEntries = Array.isArray(raw.ports) ? raw.ports : [];
	const exposeEntries = Array.isArray(raw.expose) ? raw.expose : [];
	const mappings = [...portEntries, ...exposeEntries]
		.map(parsePortEntry)
		.filter((m): m is PortMapping => m !== null);

	if (mappings.length === 0) {
		warnings.push(
			`No published port found : defaulting to ${DEFAULT_CONTAINER_PORT}, change it on the Networking tab.`,
		);
	}
	if (portEntries.length > 0) {
		warnings.push(
			"Host port mappings are dropped : Homerun routes through Traefik instead of publishing ports.",
		);
	}
	return { mappings, published: portEntries.length > 0 };
}

function limitsFor(raw: Record<string, unknown>): {
	cpuLimit: string | null;
	memoryLimitMb: number | null;
} {
	const deploy = isRecord(raw.deploy) ? raw.deploy : {};
	const resources = isRecord(deploy.resources) ? deploy.resources : {};
	const limits = isRecord(resources.limits) ? resources.limits : {};
	const rawCpus = limits.cpus ?? raw.cpus;

	return {
		cpuLimit:
			typeof rawCpus === "string" || typeof rawCpus === "number"
				? String(rawCpus)
				: null,
		memoryLimitMb:
			parseMemoryLimit(limits.memory) ?? parseMemoryLimit(raw.mem_limit),
	};
}

function draftFor(
	key: string,
	raw: Record<string, unknown>,
	usedSlugs: Set<string>,
): ComposeServiceDraft {
	const name =
		typeof raw.container_name === "string" ? raw.container_name : key;
	const slug = uniqueSlug(key, name, usedSlugs);
	const warnings = unsupportedWarnings(raw);

	const image =
		typeof raw.image === "string" && raw.image.trim()
			? raw.image.trim()
			: `${slug}:latest`;
	const { image: imageName, tag } = splitImageRef(image);

	const { mappings, published } = portsFor(raw, warnings);
	const networkMode = raw.network_mode === "host" ? "host" : "bridge";
	const volumes = (Array.isArray(raw.volumes) ? raw.volumes : [])
		.map((entry) => parseVolumeEntry(entry, slug, warnings))
		.filter((v): v is ComposeVolumeDraft => v !== null);

	return {
		containerPort: mappings[0]?.port ?? DEFAULT_CONTAINER_PORT,
		dependsOn: parseDependsOn(raw.depends_on),
		dnsResolvable: networkMode === "bridge" && published,
		envVars: parseEnvironment(raw.environment),
		image: imageName,
		key,
		name,
		networkMode,
		portProtocol: protocolFor(mappings),
		restartPolicy: parseRestart(raw.restart),
		slug,
		tag,
		volumes,
		warnings,
		...limitsFor(raw),
	};
}

export function parseComposeFile(text: string): ComposeImportPlan {
	let doc: unknown;
	try {
		doc = parseYaml(text);
	} catch (err) {
		throw new ComposeParseError(
			`That isn't valid YAML: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!isRecord(doc)) {
		throw new ComposeParseError("That doesn't look like a compose file.");
	}
	const rawServices = doc.services;
	if (!isRecord(rawServices) || Object.keys(rawServices).length === 0) {
		throw new ComposeParseError("No `services:` block found in that file.");
	}

	const warnings: string[] = [];
	const usedSlugs = new Set<string>();
	const services: ComposeServiceDraft[] = [];
	for (const [key, value] of Object.entries(rawServices)) {
		if (!isRecord(value)) {
			warnings.push(`Skipped "${key}" : it isn't a service definition.`);
			continue;
		}
		services.push(draftFor(key, value, usedSlugs));
	}
	if (services.length === 0) {
		throw new ComposeParseError("No usable services found in that file.");
	}

	const networkNames = isRecord(doc.networks) ? Object.keys(doc.networks) : [];
	if (networkNames.length > 1) {
		warnings.push(
			"Every imported service joins one project network : the file's separate networks aren't reproduced.",
		);
	}
	if (isRecord(doc.configs) || isRecord(doc.secrets)) {
		warnings.push("Top-level configs/secrets are not imported.");
	}

	const volumeNames = [
		...new Set(
			services.flatMap((svc) =>
				svc.volumes.filter((v) => v.kind === "volume").map((v) => v.source),
			),
		),
	];

	return { networkNames, services, volumeNames, warnings };
}

export function orderByDependencies(
	services: ComposeServiceDraft[],
): ComposeServiceDraft[] {
	const byKey = new Map(services.map((svc) => [svc.key, svc]));
	const ordered: ComposeServiceDraft[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();

	const visit = (svc: ComposeServiceDraft): void => {
		if (visited.has(svc.key) || visiting.has(svc.key)) {
			return;
		}
		visiting.add(svc.key);
		for (const dep of svc.dependsOn) {
			const target = byKey.get(dep);
			if (target) {
				visit(target);
			}
		}
		visiting.delete(svc.key);
		visited.add(svc.key);
		ordered.push(svc);
	};

	for (const svc of services) {
		visit(svc);
	}
	return ordered;
}
