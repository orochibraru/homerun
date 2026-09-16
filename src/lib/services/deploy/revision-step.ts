import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import { splitRevisionRef } from "$lib/revisions";
import { DockerService } from "../docker.service.ts";
import type { RevisionSource, WorkloadPlan } from "./plan.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

interface RevisionContext {
	dep: DeploymentDTO;
	svc: ServiceDTO;
}

interface RevisionImage {
	digest: string | null;
	image: string;
	tag: string;
}

function describeRevision(revision: RevisionSource): string {
	const commit = revision.gitCommit
		? ` (${revision.gitRef ? `${revision.gitRef}@` : ""}${revision.gitCommit.slice(0, 7)})`
		: "";
	const digest = revision.digest ? ` ${revision.digest.slice(0, 19)}` : "";
	return `${revision.imageRef}${digest}${commit}`;
}

/**
 * Resolves a digest-pinned revision's image : a swarm deploy just references
 * the digest directly (the daemon pulls it), but a standalone container
 * needs the image actually present locally first, so this pulls it by
 * digest when it isn't already on this host.
 */
async function pinnedByDigest(
	ctx: RevisionContext,
	revision: RevisionSource & { digest: string },
	workload: WorkloadPlan,
): Promise<RevisionImage> {
	const { image, tag } = splitRevisionRef(revision.imageRef);
	const pinned = {
		digest: revision.digest,
		image,
		tag: `${tag}@${revision.digest}`,
	};
	if (workload.kind === "swarm") {
		return pinned;
	}
	if (await DockerService.localImageId(`${image}@${revision.digest}`)) {
		await ctx.dep.appendLog(
			`Found ${image}@${revision.digest.slice(0, 19)} on this host.`,
		);
		return pinned;
	}
	await ctx.dep.appendLog(
		`${image}@${revision.digest.slice(0, 19)} isn't on this host anymore, pulling it by digest...`,
	);
	await DockerService.pullImage({
		auth: DockerService.buildAuthConfig(ctx.svc),
		image,
		onProgress: (line) => ctx.dep.appendLog(line),
		tag: pinned.tag,
	});
	return pinned;
}

/**
 * Locates the exact image a rollback revision should reuse : pulls by digest
 * via `pinnedByDigest` when the revision has one, otherwise requires the
 * plain `image:tag` to already be present locally and (when the revision
 * recorded an image id) unchanged since that revision ran.
 *
 * @throws When the revision has no digest and either the image is gone from
 *   this host, or it's still present but now points at a different image id
 *   than the one this revision actually ran.
 */
async function locateRevisionImage(
	ctx: RevisionContext,
	revision: RevisionSource,
	workload: WorkloadPlan,
): Promise<RevisionImage> {
	const { digest } = revision;
	if (digest) {
		return await pinnedByDigest(ctx, { ...revision, digest }, workload);
	}
	const { image, tag } = splitRevisionRef(revision.imageRef);
	const localId = await DockerService.localImageId(`${image}:${tag}`);
	if (localId && (!revision.imageId || localId === revision.imageId)) {
		await ctx.dep.appendLog(`Found ${image}:${tag} on this host.`);
		return { digest: null, image, tag };
	}
	throw new Error(
		localId
			? `${image}:${tag} now points at a different image than this revision ran, and the revision has no digest to pull by. Redeploy to rebuild it instead.`
			: `The image for this revision (${image}:${tag}) is no longer on this host and has no digest to pull by. Redeploy to rebuild it instead.`,
	);
}

/**
 * Resolves the image for a rollback deploy : logs that the build, registry
 * pull and image scan are all being skipped (this exact image already ran
 * here), copies the revision's build metadata onto the deployment row, then
 * locates the actual image via `locateRevisionImage` and updates the
 * service's `image`/`tag` to match.
 */
export async function resolveRevisionImage(
	ctx: RevisionContext,
	revision: RevisionSource,
	workload: WorkloadPlan,
): Promise<RevisionImage> {
	const { dep, svc } = ctx;
	await dep.appendLog(
		`Rolling back to revision ${revision.id.slice(0, 8)}: ${describeRevision(revision)}`,
	);
	await dep.appendLog(
		"Skipping the build, the registry pull and the image scan: this exact image already ran here.",
	);
	await dep.update({
		buildSource: revision.buildSource,
		gitCommit: revision.gitCommit,
		gitRef: revision.gitRef,
	});
	const resolved = await locateRevisionImage(ctx, revision, workload);
	const { image, tag } = splitRevisionRef(revision.imageRef);
	await svc.update({ image, tag });
	logger.info(
		`Revision image resolved: service=${svc.id} revision=${revision.id} ref=${resolved.image}:${resolved.tag}`,
	);
	return resolved;
}
