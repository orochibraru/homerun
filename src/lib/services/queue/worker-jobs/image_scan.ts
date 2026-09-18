import { config } from "$lib/config";
import type { JobDTO } from "$lib/dto/job-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import type { TrivySummary } from "$lib/image-scan";
import { DockerService } from "../../docker.service.ts";
import {
	DEPLOYED_SCAN_LABEL,
	ImageScanService,
	unscannedDeployedMessage,
} from "../../image-scan.service.ts";
import { imageScanJobPayload } from "../payloads.ts";
import type { WorkerJob } from "./types.ts";

/** The job's service, re-read at each stage. @throws When it was deleted since the job was queued. */
async function serviceOf(job: JobDTO): Promise<ServiceDTO> {
	const { serviceId } = imageScanJobPayload.parse(job.payload);
	const svc = await ServiceDTO.get(serviceId);
	if (!svc) {
		throw new Error("The service was deleted before its scan ran.");
	}
	return svc;
}

/** The ref the prepare step handed to the worker, falling back to the service's current one. */
function scannedRef(job: JobDTO, svc: ServiceDTO): string {
	const target = job.decryptSpec()?.target as { ref?: unknown } | undefined;
	return typeof target?.ref === "string"
		? target.ref
		: `${svc.image}:${svc.tag}`;
}

export const imageScanWorkerJob: WorkerJob | null = {
	async finalize(job, result, error) {
		const svc = await serviceOf(job);
		const ref = scannedRef(job, svc);
		const ctx = { dep: null, svc };
		const summary = result?.summary as TrivySummary | undefined;
		if (!summary) {
			await ImageScanService.recordUnscanned(
				ctx,
				[{ label: DEPLOYED_SCAN_LABEL, ref, source: { kind: "any" } }],
				[`${DEPLOYED_SCAN_LABEL}: ${error ?? "the worker returned no report"}`],
				{},
			);
			throw new Error(unscannedDeployedMessage(ref));
		}
		await ImageScanService.recordScanned(
			ctx,
			{ label: DEPLOYED_SCAN_LABEL, shown: ref },
			summary,
			null,
		);
		return { ...summary.counts, totalFindings: summary.totalFindings };
	},
	async prepare(job) {
		const target = await ImageScanService.deployedScanTarget(
			await serviceOf(job),
		);
		await DockerService.ensureSharedNetwork();
		return {
			network: config.docker.networkName,
			target: {
				auth: target.auth ?? null,
				ref: target.ref,
				source: target.source,
			},
		};
	},
};
