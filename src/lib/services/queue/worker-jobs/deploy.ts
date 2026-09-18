import { DeploymentService } from "../../deploy.service.ts";
import type { WorkerJob } from "./types.ts";

export const deployWorkerJob: WorkerJob | null = {
	finalize: (job, result, error) =>
		DeploymentService.finalizeWorkerDeploy(job, result, error),
	prepare: (job) => DeploymentService.prepareWorkerDeploy(job),
};
