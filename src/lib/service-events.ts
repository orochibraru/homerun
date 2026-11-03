export const SERVICE_EVENT_LANES = [
	"deploys",
	"config",
	"networking",
	"storage",
	"lifecycle",
] as const;

/** Which lane of a service's Activity card an event sits on. */
export type ServiceEventLane = (typeof SERVICE_EVENT_LANES)[number];

export const SERVICE_EVENT_LANE_LABELS: Record<ServiceEventLane, string> = {
	config: "Config",
	deploys: "Deploys",
	lifecycle: "Lifecycle",
	networking: "Networking",
	storage: "Storage",
};

/** One thing that happened to a service, before it's stored with its time and actor. */
export interface ServiceEventInput {
	detail: string[];
	kind: string;
	lane: ServiceEventLane;
	summary: string;
}

type Shown = "changed" | "env" | "secret" | "value";

interface FieldSpec {
	label: string;
	lane: Exclude<ServiceEventLane, "deploys">;
	shown: Shown;
}

function field(
	lane: FieldSpec["lane"],
	label: string,
	shown: Shown = "value",
): FieldSpec {
	return { label, lane, shown };
}

const FIELDS: Record<string, FieldSpec> = {
	authAllowedEmails: field("networking", "Login wall emails"),
	authAllowedGroups: field("networking", "Login wall groups"),
	authAllowedUserIds: field("networking", "Login wall users", "changed"),
	authPaths: field("networking", "Login wall paths"),
	authPathsMode: field("networking", "Login wall path mode"),
	authProviders: field("networking", "Login wall sign-in methods"),
	authRequired: field("networking", "Login wall"),
	autoDeployOnPush: field("config", "Deploy on push"),
	autoRollback: field("config", "Auto rollback"),
	blockedPaths: field("networking", "Blocked paths"),
	buildCacheBuiltin: field("config", "Built-in build cache"),
	buildCacheRegistryId: field("config", "Build cache registry", "changed"),
	buildEnvKeys: field("config", "Build-time variables"),
	buildServerAny: field("config", "Any build server"),
	buildServerRemoteHostId: field("config", "Build server", "changed"),
	buildSource: field("config", "Deploy from"),
	capAdd: field("config", "Capabilities"),
	category: field("config", "Category"),
	channelBranch: field("config", "Release channel branch"),
	channelCanaryDomain: field("config", "Canary domain"),
	channelsEnabled: field("config", "Release channels"),
	channelTagPattern: field("config", "Release tag pattern"),
	command: field("config", "Command"),
	containerPort: field("networking", "Container port"),
	cpuLimit: field("config", "CPU limit"),
	cronEnabled: field("config", "Scheduled redeploy"),
	cronSchedule: field("config", "Redeploy schedule"),
	customSslCertEnc: field("networking", "Custom certificate", "secret"),
	customSslKeyEnc: field("networking", "Custom certificate key", "secret"),
	defaultDomainEnabled: field("networking", "Default domain"),
	devices: field("config", "Devices"),
	dnsResolvable: field("networking", "Public routing"),
	domainPorts: field("networking", "Domain ports", "changed"),
	domains: field("networking", "Domains"),
	entrypoint: field("config", "Entrypoint"),
	envFiles: field("config", "Env files"),
	envVars: field("config", "Environment variables", "env"),
	environmentName: field("config", "Environment name"),
	exposedPorts: field("networking", "Exposed ports", "changed"),
	gitBakeFile: field("config", "Bake file"),
	gitBuildContext: field("config", "Build context"),
	gitBuildMethod: field("config", "Build method"),
	gitBuildTarget: field("config", "Build target"),
	gitDockerfilePath: field("config", "Dockerfile"),
	gitIgnorePaths: field("config", "Ignored paths"),
	gitPollEnabled: field("config", "Poll for pushes"),
	gitProviderId: field("config", "Git provider", "changed"),
	gitRef: field("config", "Git ref"),
	gitRepo: field("config", "Repository"),
	gitUrl: field("config", "Git URL"),
	gitWatchPaths: field("config", "Watched paths"),
	healthcheckCommand: field("config", "Health check command"),
	healthcheckDisabled: field("config", "Health check off"),
	healthcheckIntervalSeconds: field("config", "Health check interval"),
	healthcheckRetries: field("config", "Health check retries"),
	healthcheckStartPeriodSeconds: field("config", "Health check start period"),
	healthcheckTimeoutSeconds: field("config", "Health check timeout"),
	httpCacheTtl: field("networking", "Response cache"),
	icon: field("config", "Icon", "changed"),
	image: field("config", "Image"),
	imageScanEnabled: field("config", "Image scanning"),
	labels: field("config", "Labels", "changed"),
	memoryLimitMb: field("config", "Memory limit"),
	name: field("config", "Name"),
	networkMode: field("networking", "Network mode"),
	pinnedFromTag: field("config", "Pinned from tag"),
	portProtocol: field("networking", "Protocol"),
	previewAuthRequired: field("config", "Preview login wall"),
	previewDomainTemplate: field("config", "Preview domain template"),
	previewsEnabled: field("config", "Pull request previews"),
	primaryDomain: field("networking", "Main domain"),
	privileged: field("config", "Privileged"),
	publishedPorts: field("networking", "Published ports", "changed"),
	pullPolicy: field("config", "Pull policy"),
	registryPasswordEnc: field("config", "Registry password", "secret"),
	registryUrl: field("config", "Registry"),
	registryUsername: field("config", "Registry username"),
	replicas: field("lifecycle", "Replicas"),
	requireStatusChecks: field("config", "Required status checks"),
	restartPolicy: field("config", "Restart policy"),
	runAsUser: field("config", "Run as user"),
	scaleToZeroMinutes: field("config", "Scale to zero"),
	secretEnvKeys: field("config", "Environment variables", "env"),
	slug: field("config", "Slug"),
	stackId: field("config", "Stack", "changed"),
	stripPathDomains: field("networking", "Stripped path domains"),
	swarmPlacement: field("config", "Placement", "changed"),
	tag: field("config", "Tag"),
	tracesEnabled: field("config", "Tracing"),
	updateCheckEnabled: field("config", "Update checks"),
	updateScope: field("config", "Update scope"),
	updateTrialEnabled: field("config", "Update trial runs"),
	uptimeEnabled: field("config", "Uptime checks"),
};

const MAX_VALUE = 60;

/** A stored value as one short line: on/off, a comma list, "none", truncated past `MAX_VALUE`. */
export function formatEventValue(value: unknown): string {
	let text: string;
	if (value === null || value === undefined || value === "") {
		text = "none";
	} else if (typeof value === "boolean") {
		text = value ? "on" : "off";
	} else if (Array.isArray(value)) {
		text = value.length ? value.map(String).join(", ") : "none";
	} else if (typeof value === "object") {
		text = JSON.stringify(value);
	} else {
		text = String(value);
	}
	return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What changed in a service's environment, by key name only: values, secret
 * or not, never reach an event.
 */
function envChanges(
	before: { envVars?: unknown; secretEnvKeys?: unknown },
	patch: { envVars?: unknown; secretEnvKeys?: unknown },
): string[] {
	const lines: string[] = [];
	if ("envVars" in patch) {
		const old = (before.envVars ?? {}) as Record<string, string>;
		const next = (patch.envVars ?? {}) as Record<string, string>;
		for (const key of Object.keys(next)) {
			if (!(key in old)) {
				lines.push(`Added ${key}`);
			} else if (old[key] !== next[key]) {
				lines.push(`Changed ${key}`);
			}
		}
		for (const key of Object.keys(old)) {
			if (!(key in next)) {
				lines.push(`Removed ${key}`);
			}
		}
	}
	if ("secretEnvKeys" in patch) {
		const old = new Set((before.secretEnvKeys ?? []) as string[]);
		const next = new Set((patch.secretEnvKeys ?? []) as string[]);
		const remaining =
			"envVars" in patch
				? ((patch.envVars ?? {}) as Record<string, string>)
				: null;
		for (const key of next) {
			if (!old.has(key)) {
				lines.push(`Marked ${key} secret`);
			}
		}
		for (const key of old) {
			if (!next.has(key) && (!remaining || key in remaining)) {
				lines.push(`Unmarked ${key} as secret`);
			}
		}
	}
	return lines;
}

/** One field's change as a detail line, hiding what `shown` says not to print. */
function fieldLine(spec: FieldSpec, before: unknown, after: unknown): string {
	if (spec.shown === "secret") {
		if (!after) {
			return `${spec.label} removed`;
		}
		return before ? `${spec.label} replaced` : `${spec.label} set`;
	}
	if (spec.shown === "changed") {
		return `${spec.label} changed`;
	}
	return `${spec.label}: ${formatEventValue(before)} → ${formatEventValue(after)}`;
}

/** A label as it reads mid-sentence: lowercased, an acronym (CPU, URL) left alone. */
function midSentence(label: string): string {
	return /^[A-Z]{2}/.test(label)
		? label
		: `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** A lane's summary from the labels that changed on it, the first three named. */
function summarize(labels: string[]): string {
	const unique = [...new Set(labels)];
	const named = unique.slice(0, 3).map(midSentence).join(", ");
	const rest = unique.length - 3;
	return `Changed ${named}${rest > 0 ? ` and ${rest} more` : ""}`;
}

/**
 * The events an update to a service row makes, one per lane it touches:
 * each field that actually changed becomes a detail line (old → new for
 * plain settings; secrets, env values and opaque objects only by name), a
 * replica count change reads as a scale. Fields that aren't settings (status,
 * container ids, timestamps) make none.
 */
export function serviceChanges(
	before: Record<string, unknown>,
	patch: Record<string, unknown>,
): ServiceEventInput[] {
	const byLane = new Map<
		FieldSpec["lane"],
		{ detail: string[]; labels: string[] }
	>();
	let envDone = false;
	for (const [key, after] of Object.entries(patch)) {
		const spec = FIELDS[key];
		if (!spec || same(before[key], after)) {
			continue;
		}
		const group = byLane.get(spec.lane) ?? { detail: [], labels: [] };
		if (spec.shown === "env") {
			if (envDone) {
				continue;
			}
			envDone = true;
			const lines = envChanges(before, patch);
			if (lines.length === 0) {
				continue;
			}
			group.detail.push(...lines);
		} else {
			group.detail.push(fieldLine(spec, before[key], after));
		}
		group.labels.push(spec.label);
		byLane.set(spec.lane, group);
	}
	return [...byLane.entries()].map(([lane, group]) => {
		if (lane === "lifecycle") {
			const replicas = Number(patch.replicas);
			return {
				detail: group.detail,
				kind: "scale",
				lane,
				summary: `Scaled to ${replicas} ${replicas === 1 ? "replica" : "replicas"}`,
			};
		}
		if (
			group.labels.length === 1 &&
			group.labels[0] === "Environment variables"
		) {
			return {
				detail: group.detail,
				kind: "env",
				lane,
				summary:
					group.detail.length === 1
						? group.detail[0]
						: `Changed ${group.detail.length} environment variables`,
			};
		}
		return {
			detail: group.detail,
			kind: "settings",
			lane,
			summary: summarize(group.labels),
		};
	});
}
