import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import { shouldSkipPull } from "$lib/pull-policy";
import { DockerService } from "../docker.service.ts";
import { ImageScanService } from "../image-scan.service.ts";
import type { ImagePlan, WorkloadPlan } from "./plan.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

export async function pullForDeploy(
	ctx: { dep: DeploymentDTO; svc: ServiceDTO },
	plan: Extract<ImagePlan, { kind: "pull" }>,
	workload: WorkloadPlan,
): Promise<{ digest: string | null; image: string; tag: string }> {
	const { dep, svc } = ctx;
	const { image, pullPolicy, tag } = plan;
	const ref = `${image}:${tag}`;
	const policy = await ImageScanService.policyFor(svc);
	const local = await DockerService.localImageDigest(ref);
	const skip = shouldSkipPull(pullPolicy, local !== undefined);
	if (skip) {
		await dep.appendLog(skip);
		logger.info(`Image pull skipped (${pullPolicy}): ${ref} service=${svc.id}`);
		if (local === undefined) {
			throw new Error(`Pull policy is "never" and ${ref} isn't on this host.`);
		}
		await ImageScanService.scanPulled(ctx, ref, policy, local);
		return { digest: local, image, tag };
	}

	const auth = DockerService.buildAuthConfig(svc);
	const onProgress = (line: string) => dep.appendLog(line);
	if (policy.enabled) {
		const mirrored = await ImageScanService.deployThroughMirror(
			ctx,
			{ auth, image, swarm: workload.kind === "swarm", tag },
			policy,
			onProgress,
		);
		if (mirrored) {
			return mirrored;
		}
	}

	const { digest } = await DockerService.pullImage({
		auth,
		image,
		onProgress,
		tag,
	});
	logger.info(
		`Image pulled: ${ref} digest=${digest ?? "unknown"} service=${svc.id}`,
	);
	await ImageScanService.scanPulled(ctx, ref, policy, digest);
	return { digest, image, tag };
}
