import { config } from "$lib/config";
import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ImageScanDTO } from "$lib/dto/image-scan-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { JobDTO } from "$lib/dto/job-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import {
	countsLine,
	type ScanBlockPolicy,
	type TrivySummary,
} from "$lib/image-scan";
import { Logger } from "$lib/logger";
import { type ScanTarget } from "./deploy/scan-targets.ts";
import { isMirrorRef } from "./docker/image-scan-refs.ts";
import { DockerService } from "./docker.service.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import { imageScanMessage } from "./notification-messages.ts";
import { QueueService } from "./queue.service.ts";

const logger = new Logger("ImageScan");

const LOGGED_FINDINGS = 5;

export interface ScanPolicy {
	block: ScanBlockPolicy;
	enabled: boolean;
	required: boolean;
}

export interface ScanContext {
	dep: DeploymentDTO | null;
	svc: ServiceDTO;
}

export class ImageScanBlockedError extends Error {
	override name = "ImageScanBlockedError";
}

export const DEPLOYED_SCAN_LABEL = "the deployed image";

/** The job error for an on-demand scan of `ref` that couldn't scan at all. */
export function unscannedDeployedMessage(ref: string): string {
	return `Couldn't scan ${ref}. The scan history on the Security tab has the reason.`;
}

class ImageScanServiceClass {
	/** The effective scan policy for a service: instance-wide scanning and block policy, AND with the service's own opt-in. */
	async policyFor(svc: ServiceDTO): Promise<ScanPolicy> {
		const settings = await InstanceSettingsDTO.get();
		return {
			block: settings.imageScanBlockPolicy,
			enabled: settings.imageScanEnabled && svc.imageScanEnabled,
			required: settings.imageScanRequired,
		};
	}

	/** Appends a line to the deployment's log, when the scan is running as part of one. */
	async #log(ctx: ScanContext, line: string): Promise<void> {
		await ctx.dep?.appendLog(line);
	}

	/** Logs a scan's finding counts, plus up to `LOGGED_FINDINGS` critical/high findings, to the deployment log. */
	async #logSummary(
		ctx: ScanContext,
		ref: string,
		summary: TrivySummary,
	): Promise<void> {
		await this.#log(
			ctx,
			`Image scan of ${ref}: ${countsLine(summary.counts)}.`,
		);
		const serious = summary.findings
			.filter(
				(finding) =>
					finding.severity === "CRITICAL" || finding.severity === "HIGH",
			)
			.slice(0, LOGGED_FINDINGS);
		for (const finding of serious) {
			// oxlint-disable-next-line no-await-in-loop -- log lines are appended in order
			await this.#log(
				ctx,
				`  ${finding.severity} ${finding.id} in ${finding.pkg} ${finding.installedVersion}${finding.fixedVersion ? `, fixed in ${finding.fixedVersion}` : ""}`,
			);
		}
		if (summary.totalFindings > serious.length && serious.length > 0) {
			await this.#log(ctx, "  Full list on the service's Security tab.");
		}
	}

	/**
	 * When a scan found critical vulnerabilities, records an in-app
	 * notification and dispatches it through the user's configured
	 * notification channels. No-op when `summary.counts.critical` is 0.
	 */
	#notifyCritical(ctx: ScanContext, ref: string, summary: TrivySummary): void {
		if (summary.counts.critical === 0) {
			return;
		}
		const { svc } = ctx;
		NotificationDTO.notify({
			message: `"${svc.name}" has ${summary.counts.critical} critical ${summary.counts.critical === 1 ? "vulnerability" : "vulnerabilities"} in ${ref}.`,
			serviceId: svc.id,
			type: "image_scan_critical",
		});
		NotificationChannelService.notify(
			imageScanMessage(
				{
					counts: summary.counts,
					findings: summary.findings,
					imageRef: ref,
					origin: config.auth.origin ?? null,
					service: { id: svc.id, name: svc.name },
				},
				new Date().toISOString(),
			),
		);
	}

	/**
	 * Records a successful scan (`status: "ok"`), logs its summary to the
	 * deployment log when there is one, and notifies on critical findings.
	 */
	async recordScanned(
		ctx: ScanContext,
		target: { label: string; shown: string },
		summary: TrivySummary,
		digest: string | null,
	): Promise<void> {
		await ImageScanDTO.create({
			counts: summary.counts,
			deploymentId: ctx.dep?.id ?? null,
			digest,
			findings: summary.findings,
			fixableCounts: summary.fixableCounts,
			imageRef: target.shown,
			serviceId: ctx.svc.id,
			source: target.label,
			status: "ok",
			totalFindings: summary.totalFindings,
		});
		await this.#logSummary(ctx, target.shown, summary);
		logger.info(
			`Image scanned: service=${ctx.svc.id} ref=${target.shown} ${countsLine(summary.counts)}`,
		);
		this.#notifyCritical(ctx, target.shown, summary);
	}

	/**
	 * Records a scan where no target could be scanned (`status: "failed"`,
	 * with every target's error) and decides whether the deploy may go ahead.
	 *
	 * @throws `ImageScanBlockedError` when `options.required` is set.
	 */
	async recordUnscanned(
		ctx: ScanContext,
		targets: ScanTarget[],
		failures: string[],
		options: { digest?: string | null; required?: boolean },
	): Promise<null> {
		const error = failures.join("; ") || "no scan target";
		await ImageScanDTO.create({
			deploymentId: ctx.dep?.id ?? null,
			digest: options.digest ?? null,
			error,
			imageRef: targets[0]?.display ?? targets[0]?.ref ?? "",
			serviceId: ctx.svc.id,
			source: targets[0]?.label ?? "",
			status: "failed",
		});
		logger.warn(`Image scan failed: service=${ctx.svc.id} ${error}`);
		if (options.required) {
			const message =
				"The image couldn't be scanned, and this instance requires a successful scan before deploying.";
			await this.#log(ctx, message);
			throw new ImageScanBlockedError(message);
		}
		await this.#log(
			ctx,
			"The image couldn't be scanned. Deploying anyway, since a successful scan isn't required on this instance.",
		);
		return null;
	}

	/** Whether an `image_scan` job for this service is currently active in the queue. */
	async isScanning(serviceId: string): Promise<boolean> {
		return (
			(await JobDTO.findActive("image_scan", `image_scan:${serviceId}`)) !==
			null
		);
	}

	/** Enqueues an on-demand `image_scan` job for a service, deduplicated so only one runs at a time per service. */
	enqueueScan(svc: ServiceDTO, userId: string): Promise<JobDTO> {
		return QueueService.enqueue({
			dedupeKey: `image_scan:${svc.id}`,
			lockKey: `image_scan:${svc.id}`,
			payload: { serviceId: svc.id, userId },
			serviceId: svc.id,
			title: `Scan ${svc.name}`,
			type: "image_scan",
			userId,
		});
	}

	/**
	 * The scan target for a service's deployed image: read from the local
	 * daemon or its registry, with the service's registry credentials, or
	 * Homerun's own when the image lives in the built-in registry.
	 */
	async deployedScanTarget(svc: ServiceDTO): Promise<ScanTarget> {
		const ref = `${svc.image}:${svc.tag}`;
		const auth = isMirrorRef(ref)
			? ((await DockerService.registryInternalAuth()) ??
				DockerService.buildAuthConfig(svc))
			: DockerService.buildAuthConfig(svc);
		return {
			auth,
			label: DEPLOYED_SCAN_LABEL,
			ref,
			source: { kind: "any" },
		};
	}
}

export const ImageScanService = new ImageScanServiceClass();
