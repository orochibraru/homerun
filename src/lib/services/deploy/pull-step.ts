import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import { shouldSkipPull } from "$lib/pull-policy";
import { DockerService } from "../docker.service.ts";
import { ImageScanService } from "../image-scan.service.ts";
import type { ImagePlan, WorkloadPlan } from "./plan.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

/**
 * Resolves the image for a `buildSource: "image"` deploy : honors the
 * service's pull policy (skipping the pull entirely when the image is
 * already local and the policy allows it), routes the pull through the
 * mirror registry when an image-scan policy is enabled for the service, and
 * falls back to a direct registry pull otherwise. Appends progress to the
 * deployment's log and triggers a post-pull image scan before returning.
 *
 * @throws When the pull policy is `"never"` and the image isn't already on
 *   this host.
 */
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
