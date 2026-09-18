import { config } from "$lib/config";
import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ImageScanDTO } from "$lib/dto/image-scan-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { JobDTO } from "$lib/dto/job-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import {
	countsLine,
	evaluateScanPolicy,
	type ScanBlockPolicy,
	type TrivySummary,
} from "$lib/image-scan";
import { Logger } from "$lib/logger";
import type { GitBuildPlan } from "./deploy/plan.ts";
import {
	buildScanTargets,
	localScanTarget,
	type ScanTarget,
} from "./deploy/scan-targets.ts";
import type { RegistryAuth } from "./docker/containers.ts";
import {
	isMirrorRef,
	MIRROR_SCAN_SOURCE,
	pinnedToDigest,
} from "./docker/image-scan-refs.ts";
import { DockerService, type MirrorCopyResult } from "./docker.service.ts";
import { ImageMirrorGcService } from "./image-mirror-gc.service.ts";
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

export interface MirrorDeployInput {
	auth?: RegistryAuth;
	image: string;
	swarm: boolean;
	tag: string;
}

export interface MirroredImage {
	digest: string | null;
	image: string;
	tag: string;
}

export class ImageScanBlockedError extends Error {
	override name = "ImageScanBlockedError";
}

export const DEPLOYED_SCAN_LABEL = "the deployed image";

/** The job error for an on-demand scan of `ref` that couldn't scan at all. */
export function unscannedDeployedMessage(ref: string): string {
	return `Couldn't scan ${ref}. The scan history on the Security tab has the reason.`;
}

function reason(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
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
			// biome-ignore lint/performance/noAwaitInLoops: log lines are appended in order
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
	 * Tries each scan target in order until one scans successfully, recording
	 * the result (`ImageScanDTO.create`) and logging/notifying on it. A
	 * scanner failure on a target falls through to the next one; when every
	 * target fails the deploy goes ahead unless `options.required` is set.
	 *
	 * @returns The successful scan's summary, or `null` when every target
	 *   failed to scan (recorded as `status: "failed"`).
	 * @throws `ImageScanBlockedError` when the result violates
	 *   `options.block`, or when nothing could be scanned and
	 *   `options.required` is set, after logging the reason to the deployment
	 *   log.
	 */
	async scan(
		ctx: ScanContext,
		targets: ScanTarget[],
		options: {
			block: ScanBlockPolicy | null;
			digest?: string | null;
			required?: boolean;
		},
	): Promise<TrivySummary | null> {
		const failures: string[] = [];
		for (const target of targets) {
			const shown = target.display ?? target.ref;
			// biome-ignore lint/performance/noAwaitInLoops: targets are fallbacks, tried one after another
			await this.#log(
				ctx,
				`Scanning ${shown} for vulnerabilities (${target.label})...`,
			);
			let summary: TrivySummary;
			try {
				summary = await DockerService.scanImage({
					auth: target.auth,
					ref: target.ref,
					source: target.source,
				});
			} catch (err) {
				failures.push(`${target.label}: ${reason(err)}`);
				await this.#log(
					ctx,
					`Image scan of ${target.label} failed: ${reason(err)}`,
				);
				continue;
			}
			await this.recordScanned(
				ctx,
				{ label: target.label, shown },
				summary,
				options.digest ?? null,
			);
			const verdict = options.block
				? evaluateScanPolicy(summary, options.block)
				: null;
			if (verdict?.reason) {
				await this.#log(ctx, verdict.reason);
				logger.warn(
					`Deploy blocked by the image scan policy: service=${ctx.svc.id} ref=${shown}`,
				);
				throw new ImageScanBlockedError(verdict.reason);
			}
			return summary;
		}

		return await this.recordUnscanned(ctx, targets, failures, options);
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

	/** Scans a freshly pulled bring-your-own-image, or records it as skipped when `policy` is disabled. */
	async scanPulled(
		ctx: ScanContext,
		ref: string,
		policy: ScanPolicy,
		digest: string | null,
	): Promise<void> {
		if (!policy.enabled) {
			await this.recordSkipped(ctx, ref, "Scanning is turned off.");
			return;
		}
		await this.scan(ctx, [localScanTarget(ref)], {
			block: policy.block,
			digest,
			required: policy.required,
		});
	}

	/** Scans a freshly built git-based image against `plan`'s scan targets, or records it as skipped when scanning is disabled. */
	async scanBuilt(
		ctx: ScanContext,
		plan: GitBuildPlan,
		built: { image: string; tag: string },
	): Promise<void> {
		const policy = await this.policyFor(ctx.svc);
		if (!policy.enabled) {
			await this.recordSkipped(
				ctx,
				`${built.image}:${built.tag}`,
				"Scanning is turned off.",
			);
			return;
		}
		await this.scan(ctx, buildScanTargets(plan, built), {
			block: policy.block,
			required: policy.required,
		});
	}

	/** Records a scan history row with `status: "skipped"`, for a deploy that didn't scan at all. */
	async recordSkipped(
		ctx: ScanContext,
		imageRef: string,
		why: string,
	): Promise<void> {
		await ImageScanDTO.create({
			deploymentId: ctx.dep?.id ?? null,
			error: why,
			imageRef,
			serviceId: ctx.svc.id,
			source: "none",
			status: "skipped",
		});
	}

	/**
	 * Copies the image into the local Homerun mirror registry, scans it from
	 * there, and then either pins the swarm service to the scanned digest or
	 * pulls the scanned image onto this host. Falls back to a direct pull
	 * (scanned on this host instead) when the mirror is being cleaned up,
	 * can't take the copy, or a pull from it fails.
	 *
	 * @returns The resulting image/tag (and digest, when known), or `null`
	 *   when it fell back to a direct pull without going through this method's
	 *   own scan step.
	 */
	async deployThroughMirror(
		ctx: ScanContext & { dep: DeploymentDTO },
		input: MirrorDeployInput,
		policy: ScanPolicy,
		onProgress: (line: string) => void,
	): Promise<MirroredImage | null> {
		const { image, tag } = input;
		const ref = `${image}:${tag}`;
		if (ImageMirrorGcService.running) {
			await this.#log(
				ctx,
				"The Homerun mirror is being cleaned up. Pulling directly; the image is scanned on this host instead.",
			);
			return null;
		}
		await this.#log(
			ctx,
			`Copying ${ref} into the Homerun mirror for scanning...`,
		);
		let copied: Awaited<ReturnType<typeof DockerService.copyToMirror>>;
		try {
			copied = await DockerService.copyToMirror({
				auth: input.auth,
				image,
				tag,
			});
		} catch (err) {
			logger.warn(
				`Mirror copy failed: service=${ctx.svc.id} ref=${ref} : ${reason(err)}`,
			);
			await this.#log(
				ctx,
				`The mirror couldn't take the image (${reason(err)}). Falling back to a direct pull; the image is scanned on this host instead.`,
			);
			return null;
		}

		await this.scan(
			ctx,
			[
				{
					display: copied.digest ? `${ref}@${copied.digest}` : ref,
					label: MIRROR_SCAN_SOURCE,
					ref: copied.refs.internalRef,
					source: { insecure: true, kind: "remote" },
				},
			],
			{
				block: policy.block,
				digest: copied.digest,
				required: policy.required,
			},
		);

		if (input.swarm) {
			if (!copied.digest) {
				await this.#log(
					ctx,
					"The mirror didn't report a digest, so the swarm service isn't pinned to the scanned image.",
				);
				return { digest: null, image, tag };
			}
			await this.#log(
				ctx,
				`Pinning the swarm service to the scanned digest ${copied.digest}.`,
			);
			return {
				digest: copied.digest,
				...pinnedToDigest(image, tag, copied.digest),
			};
		}

		const digest = await this.#fetchFromMirror(ctx, copied, input, onProgress);
		return { digest: copied.digest ?? digest, image, tag };
	}

	/**
	 * Gets a scanned image out of the mirror onto this host : a loopback pull,
	 * or on rootless Docker (whose daemon can't reach the loopback port) and
	 * whenever that pull fails, a `docker load` streamed from the mirror, so
	 * the host still runs the exact bytes that were scanned. Only when both
	 * fail does it pull the image from its upstream registry.
	 *
	 * @returns The digest the pull reported, when there was one.
	 */
	async #fetchFromMirror(
		ctx: ScanContext & { dep: DeploymentDTO },
		copied: MirrorCopyResult,
		input: MirrorDeployInput,
		onProgress: (line: string) => void,
	): Promise<string | null> {
		const { image, tag } = input;
		const ref = `${image}:${tag}`;
		const rootless = await DockerService.isRootlessDocker();
		if (!rootless) {
			try {
				await this.#log(ctx, "Pulling the scanned image from the mirror...");
				const pulled = await DockerService.pullFromMirror(
					copied.refs,
					{ image, tag },
					onProgress,
				);
				return pulled.digest;
			} catch (err) {
				logger.warn(
					`Mirror pull failed: service=${ctx.svc.id} ref=${ref} : ${reason(err)}`,
				);
				await this.#log(
					ctx,
					`This host couldn't pull from the mirror (${reason(err)}). Loading the scanned image from the mirror instead.`,
				);
			}
		} else {
			await this.#log(
				ctx,
				"Rootless Docker can't pull from the mirror's loopback port, loading the scanned image from the mirror instead.",
			);
		}
		try {
			await DockerService.loadFromMirror(
				copied.refs,
				{ image, tag },
				onProgress,
			);
			return null;
		} catch (err) {
			logger.warn(
				`Mirror load failed: service=${ctx.svc.id} ref=${ref} : ${reason(err)}`,
			);
			await this.#log(
				ctx,
				`The scanned image couldn't be loaded from the mirror (${reason(err)}). Falling back to a direct pull of ${ref}.`,
			);
		}
		const pulled = await DockerService.pullImage({
			auth: input.auth,
			image,
			onProgress,
			tag,
		});
		return pulled.digest;
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
	 * Runs an on-demand scan of a service's already-deployed image, outside
	 * any deploy or block policy (`block: null`).
	 *
	 * @throws When the image can't be scanned at all.
	 */
	async scanDeployed(svc: ServiceDTO): Promise<TrivySummary> {
		const target = await this.deployedScanTarget(svc);
		const summary = await this.scan({ dep: null, svc }, [target], {
			block: null,
		});
		if (!summary) {
			throw new Error(unscannedDeployedMessage(target.ref));
		}
		return summary;
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
