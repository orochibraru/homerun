import { config } from "$lib/config";
import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ImageScanDTO } from "$lib/dto/image-scan-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { JobDTO } from "$lib/dto/job-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import {
	type BlockSeverity,
	blockReason,
	countsLine,
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
	MIRROR_SCAN_SOURCE,
	pinnedToDigest,
} from "./docker/image-scan-refs.ts";
import { DockerService } from "./docker.service.ts";
import { ImageMirrorGcService } from "./image-mirror-gc.service.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import { imageScanMessage } from "./notification-messages.ts";
import { QueueService } from "./queue.service.ts";

const logger = new Logger("ImageScan");

const LOGGED_FINDINGS = 5;

export interface ScanPolicy {
	blockSeverity: BlockSeverity | null;
	enabled: boolean;
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

function reason(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

class ImageScanServiceClass {
	async policyFor(svc: ServiceDTO): Promise<ScanPolicy> {
		const settings = await InstanceSettingsDTO.get();
		return {
			blockSeverity: settings.imageScanBlockSeverity,
			enabled: settings.imageScanEnabled && svc.imageScanEnabled,
		};
	}

	async #log(ctx: ScanContext, line: string): Promise<void> {
		await ctx.dep?.appendLog(line);
	}

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

	#notifyCritical(ctx: ScanContext, ref: string, summary: TrivySummary): void {
		if (summary.counts.critical === 0) {
			return;
		}
		const { svc } = ctx;
		NotificationDTO.notify({
			message: `"${svc.name}" has ${summary.counts.critical} critical ${summary.counts.critical === 1 ? "vulnerability" : "vulnerabilities"} in ${ref}.`,
			serviceId: svc.id,
			type: "image_scan_critical",
			userId: svc.userId,
		});
		NotificationChannelService.notify(
			svc.userId,
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

	async scan(
		ctx: ScanContext,
		targets: ScanTarget[],
		options: { blockSeverity: BlockSeverity | null; digest?: string | null },
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
			await ImageScanDTO.create({
				counts: summary.counts,
				deploymentId: ctx.dep?.id ?? null,
				digest: options.digest ?? null,
				findings: summary.findings,
				imageRef: shown,
				serviceId: ctx.svc.id,
				source: target.label,
				status: "ok",
				totalFindings: summary.totalFindings,
			});
			await this.#logSummary(ctx, shown, summary);
			logger.info(
				`Image scanned: service=${ctx.svc.id} ref=${shown} ${countsLine(summary.counts)}`,
			);
			this.#notifyCritical(ctx, shown, summary);
			const blocked = blockReason(summary.counts, options.blockSeverity);
			if (blocked) {
				throw new ImageScanBlockedError(blocked);
			}
			return summary;
		}

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
		await this.#log(
			ctx,
			"The image couldn't be scanned. Deploying anyway : a scanner failure never blocks a deploy.",
		);
		return null;
	}

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
			blockSeverity: policy.blockSeverity,
			digest,
		});
	}

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
			blockSeverity: policy.blockSeverity,
		});
	}

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
			{ blockSeverity: policy.blockSeverity, digest: copied.digest },
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

		try {
			await this.#log(ctx, "Pulling the scanned image from the mirror...");
			const pulled = await DockerService.pullFromMirror(
				copied.refs,
				{ image, tag },
				onProgress,
			);
			return { digest: copied.digest ?? pulled.digest, image, tag };
		} catch (err) {
			logger.warn(
				`Mirror pull failed: service=${ctx.svc.id} ref=${ref} : ${reason(err)}`,
			);
			await this.#log(
				ctx,
				`This host couldn't pull from the mirror (${reason(err)}). Falling back to a direct pull of ${ref}.`,
			);
			const pulled = await DockerService.pullImage({
				auth: input.auth,
				image,
				onProgress,
				tag,
			});
			return { digest: pulled.digest, image, tag };
		}
	}

	async isScanning(serviceId: string): Promise<boolean> {
		return (
			(await JobDTO.findActive("image_scan", `image_scan:${serviceId}`)) !==
			null
		);
	}

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

	async scanDeployed(svc: ServiceDTO): Promise<TrivySummary> {
		const ref = `${svc.image}:${svc.tag}`;
		const target = localScanTarget(ref);
		const summary = await this.scan(
			{ dep: null, svc },
			[
				{
					...target,
					auth: DockerService.buildAuthConfig(svc),
					label: "the deployed image",
					source: { kind: "any" },
				},
			],
			{ blockSeverity: null },
		);
		if (!summary) {
			throw new Error(
				`Couldn't scan ${ref}. The scan history on the Security tab has the reason.`,
			);
		}
		return summary;
	}
}

export const ImageScanService = new ImageScanServiceClass();
