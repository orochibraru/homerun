export type DeployPhaseId =
	| "config"
	| "volumes"
	| "image"
	| "container"
	| "network"
	| "ready";

export interface DeployPhase {
	id: DeployPhaseId;
	label: string;
}

export const PHASE_MARKER = "▸ ";

export const DEPLOY_PHASES: DeployPhase[] = [
	{ id: "config", label: "Resolving configuration" },
	{ id: "volumes", label: "Preparing volumes" },
	{ id: "image", label: "Fetching image" },
	{ id: "container", label: "Provisioning container" },
	{ id: "network", label: "Routing traffic" },
	{ id: "ready", label: "Ready" },
];

export type DeployPhaseState = "pending" | "active" | "done" | "failed";

export function phaseLine(id: DeployPhaseId): string {
	const phase = DEPLOY_PHASES.find((p) => p.id === id);
	return `${PHASE_MARKER}${phase ? phase.label : id}`;
}

export function isPhaseLine(line: string): boolean {
	return line.startsWith(PHASE_MARKER);
}

export function currentPhase(log: string): DeployPhaseId | null {
	const labels = new Map(DEPLOY_PHASES.map((p) => [p.label, p.id]));
	let current: DeployPhaseId | null = null;
	for (const line of log.split("\n")) {
		if (!isPhaseLine(line)) {
			continue;
		}
		const id = labels.get(line.slice(PHASE_MARKER.length).trim());
		if (id) {
			current = id;
		}
	}
	return current;
}

/**
 * The image phase's label depends on where the image comes from: a git-based
 * service builds one, it doesn't fetch one, and "Fetching image" while a
 * Dockerfile build streams past is just wrong.
 */
export function phasesFor(buildSource: "git" | "image"): DeployPhase[] {
	if (buildSource !== "git") {
		return DEPLOY_PHASES;
	}
	return DEPLOY_PHASES.map((phase) =>
		phase.id === "image" ? { ...phase, label: "Building image" } : phase,
	);
}

export function deployPhaseStates(
	log: string,
	status: string,
	buildSource: "git" | "image" = "image",
): Array<{ phase: DeployPhase; state: DeployPhaseState }> {
	const current = currentPhase(log);
	const phases = phasesFor(buildSource);
	const index = current ? phases.findIndex((p) => p.id === current) : -1;
	const failed = status === "failed";
	const finished = status === "running" || status === "stopped";

	return phases.map((phase, i) => {
		if (finished) {
			return { phase, state: "done" as DeployPhaseState };
		}
		if (i < index) {
			return { phase, state: "done" as DeployPhaseState };
		}
		if (i === index) {
			return {
				phase,
				state: (failed ? "failed" : "active") as DeployPhaseState,
			};
		}
		return { phase, state: "pending" as DeployPhaseState };
	});
}
