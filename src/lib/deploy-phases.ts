export type DeployPhaseId =
	| "config"
	| "volumes"
	| "source"
	| "image"
	| "scan"
	| "container"
	| "health"
	| "network"
	| "ready";

export interface DeployPhase {
	hint: string;
	id: DeployPhaseId;
	label: string;
	marker: string;
}

export const PHASE_MARKER = "▸ ";

export const DEPLOY_PHASES: DeployPhase[] = [
	{
		hint: "Reads the service's settings, its revision and its repository's manifest.",
		id: "config",
		label: "Configuration",
		marker: "Resolving configuration",
	},
	{
		hint: "Mounts the service's volumes and syncs its DNS records.",
		id: "volumes",
		label: "Volumes",
		marker: "Preparing volumes",
	},
	{
		hint: "Clones the repository at the commit being deployed.",
		id: "source",
		label: "Clone",
		marker: "Cloning repository",
	},
	{
		hint: "Pulls the image from its registry.",
		id: "image",
		label: "Pull",
		marker: "Fetching image",
	},
	{
		hint: "Scans the image for known vulnerabilities.",
		id: "scan",
		label: "Scan",
		marker: "Scanning image",
	},
	{
		hint: "Creates and starts the new container or swarm tasks.",
		id: "container",
		label: "Start",
		marker: "Provisioning container",
	},
	{
		hint: "Waits for the new workload to pass its readiness check before it gets traffic.",
		id: "health",
		label: "Health check",
		marker: "Waiting until healthy",
	},
	{
		hint: "Checks Traefik routes the service's domains to the new workload.",
		id: "network",
		label: "Routing",
		marker: "Routing traffic",
	},
	{
		hint: "The new revision is live.",
		id: "ready",
		label: "Live",
		marker: "Ready",
	},
];

export const TRIAL_PHASES: DeployPhase[] = [
	{
		hint: "Pulls the new version from its registry.",
		id: "image",
		label: "Pull",
		marker: "Fetching image",
	},
	{
		hint: "Starts the new version in a throwaway container with no volumes, ports or domains.",
		id: "container",
		label: "Start",
		marker: "Provisioning container",
	},
	{
		hint: "Waits for it to pass the readiness check a real deploy would use.",
		id: "health",
		label: "Health check",
		marker: "Waiting until healthy",
	},
	{
		hint: "The new version came up.",
		id: "ready",
		label: "Passed",
		marker: "Ready",
	},
];

export type DeployPhaseState =
	"pending" | "active" | "done" | "failed" | "skipped";

/**
 * Formats the marker line a deploy writes to its log when it enters a phase, so
 * the UI can later recognise it with `currentPhase`.
 */
export function phaseLine(id: DeployPhaseId): string {
	const phase = DEPLOY_PHASES.find((p) => p.id === id);
	return `${PHASE_MARKER}${phase ? phase.marker : id}`;
}

/** Whether a deploy-log line is a phase marker rather than ordinary output. */
export function isPhaseLine(line: string): boolean {
	return line.startsWith(PHASE_MARKER);
}

/** The phase a marker line enters, or null for any other line. */
function phaseOf(line: string): DeployPhaseId | null {
	if (!isPhaseLine(line)) {
		return null;
	}
	const marker = line.slice(PHASE_MARKER.length).trim();
	return DEPLOY_PHASES.find((p) => p.marker === marker)?.id ?? null;
}

/** Every phase a deploy log has entered, in the order it entered them. */
export function enteredPhases(log: string): DeployPhaseId[] {
	const entered: DeployPhaseId[] = [];
	for (const line of log.split("\n")) {
		const id = phaseOf(line);
		if (id && !entered.includes(id)) {
			entered.push(id);
		}
	}
	return entered;
}

/**
 * Scans a deploy log for phase marker lines and returns the last phase entered,
 * or null when no marker has been written yet.
 */
export function currentPhase(log: string): DeployPhaseId | null {
	return enteredPhases(log).at(-1) ?? null;
}

/**
 * The phases a deploy of a service built from `buildSource` goes through: a
 * git build clones and builds its image, an image service pulls one and has
 * nothing to clone.
 */
export function phasesFor(buildSource: "git" | "image"): DeployPhase[] {
	if (buildSource !== "git") {
		return DEPLOY_PHASES.filter((phase) => phase.id !== "source");
	}
	return DEPLOY_PHASES.map((phase) =>
		phase.id === "image"
			? {
					...phase,
					hint: "Builds the image from the repository.",
					label: "Build",
				}
			: phase,
	);
}

/**
 * Derives the progress state of every deploy phase from the log written so far
 * and the service's status, for the deploy stepper. A phase the deploy went
 * past without entering (no scan when scanning is off, no health wait on a
 * first deploy) is skipped.
 *
 * @param status The service status; `running` or `stopped` marks every entered
 * phase done, `failed` marks the current phase failed.
 * @param buildSource Picks the phases and their labels, see `phasesFor`.
 * @param phases Overrides the phases, for a run that isn't a deploy (an update trial).
 */
export function deployPhaseStates(
	log: string,
	status: string,
	buildSource: "git" | "image" = "image",
	phases: DeployPhase[] = phasesFor(buildSource),
): Array<{ phase: DeployPhase; state: DeployPhaseState }> {
	const entered = enteredPhases(log);
	const current = entered.at(-1) ?? null;
	const index = current ? phases.findIndex((p) => p.id === current) : -1;
	const failed = status === "failed";
	const finished = status === "running" || status === "stopped";

	return phases.map((phase, i) => {
		const seen = entered.includes(phase.id);
		if (finished) {
			return {
				phase,
				state: seen || entered.length === 0 ? "done" : "skipped",
			};
		}
		if (i < index) {
			return { phase, state: seen ? "done" : "skipped" };
		}
		if (i === index) {
			return { phase, state: failed ? "failed" : "active" };
		}
		return { phase, state: "pending" };
	});
}
