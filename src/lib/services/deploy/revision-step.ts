import { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import {
	changedRevisionConfigFields,
	restorableRuntimeOptions,
} from "$lib/revision-config";

const logger = new Logger(DEPLOY_LOG_SCOPE);

interface RevisionContext {
	dep: DeploymentDTO;
	svc: ServiceDTO;
}

/**
 * For a rollback asked to restore config, writes the target revision's
 * recorded env vars, resources and networking back onto the service before
 * the deploy plan is built, so the workload starts with them. A revision
 * recorded before snapshots existed is logged and skipped rather than
 * failing the rollback.
 */
export async function restoreRevisionConfig(
	ctx: RevisionContext,
	revisionId: string,
): Promise<void> {
	const { dep, svc } = ctx;
	const snapshot = (await DeploymentDTO.get(revisionId))?.configSnapshot;
	if (!snapshot) {
		await dep.appendLog(
			"This revision has no recorded environment, resources or networking to restore, keeping the current ones.",
		);
		return;
	}
	const changed = changedRevisionConfigFields(svc.toJSON(), snapshot);
	await dep.appendLog(
		changed.length > 0
			? `Restoring this revision's config: ${changed.join(", ")}.`
			: "This revision's environment, resources and networking match the current ones.",
	);
	await svc.update({
		containerPort: snapshot.containerPort,
		cpuLimit: snapshot.cpuLimit,
		dnsResolvable: snapshot.dnsResolvable,
		envVars: snapshot.envVars,
		memoryLimitMb: snapshot.memoryLimitMb,
		networkMode: snapshot.networkMode,
		portProtocol: snapshot.portProtocol,
		...(snapshot.publishedPorts
			? { publishedPorts: snapshot.publishedPorts }
			: {}),
		replicas: snapshot.replicas,
		...restorableRuntimeOptions(snapshot),
	});
	logger.info(
		`Revision config restored: service=${svc.id} revision=${revisionId} fields=${changed.join("|") || "none"}`,
	);
}
