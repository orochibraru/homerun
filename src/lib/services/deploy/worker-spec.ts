import { config } from "$lib/config";
import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import type { StackDTO } from "$lib/dto/stack-dto";
import { cloneFailureHint } from "$lib/git-clone-url";
import { splitImageRef } from "$lib/image-ref";
import { runtimeOptionsFrom } from "$lib/service-runtime";
import {
	containerCreateTemplate,
	type RegistryAuth,
} from "../docker/containers.ts";
import { dockerHealthcheck } from "../docker/healthcheck.ts";
import {
	MIRROR_CONTAINER_NAME,
	MIRROR_INTERNAL_PORT,
	MIRROR_SCAN_SOURCE,
	mirrorRefs,
	normalizeImageRef,
	REGISTRY_AUTH_ENV,
	registryAuthFileFor,
	SKOPEO_IMAGE,
	SKOPEO_TAG,
	skopeoArchiveCommand,
	skopeoCopyCommand,
} from "../docker/image-scan-refs.ts";
import { stackNetworkName } from "../docker/networks.ts";
import { listeningHealthcheck } from "../docker/readiness.ts";
import { swarmNetworkName, swarmServiceTemplate } from "../docker/swarm.ts";
import { DockerService } from "../docker.service.ts";
import { ImageMirrorGcService } from "../image-mirror-gc.service.ts";
import { ImageScanService, type ScanPolicy } from "../image-scan.service.ts";
import {
	resolveGitCredential,
	type ServiceMounts,
	toVolumeParams,
} from "./helpers.ts";
import {
	type BuildServer,
	type CacheRegistryCredentials,
	type DeployPlan,
	type GitBuildPlan,
	type ImagePlan,
	unreachable,
	type WorkloadPlan,
} from "./plan.ts";
import {
	buildScanTargets,
	localScanTarget,
	type ScanTarget,
} from "./scan-targets.ts";
import { enforceStatusChecks } from "./status-check-step.ts";

export interface WorkerSpecContext {
	dep: DeploymentDTO;
	mounts: ServiceMounts;
	plan: DeployPlan;
	stack: StackDTO | null;
	svc: ServiceDTO;
	userId: string;
}

/** The registry ref a cross-host build publishes `built` under, e.g. `registry.example.com/homerun-build-api:abc`. */
function publishedImageRef(
	registry: CacheRegistryCredentials,
	built: { image: string; tag: string },
) {
	return { image: `${registry.registryUrl}/${built.image}`, tag: built.tag };
}

function scanTargetSpec(target: ScanTarget) {
	return {
		auth: target.auth ?? null,
		display: target.display ?? "",
		label: target.label,
		ref: target.ref,
		source: target.source,
	};
}

function scanSpec(policy: ScanPolicy, targets: ScanTarget[]) {
	return policy.enabled
		? {
				block: {
					fixableOnly: policy.block.fixableOnly,
					severity: policy.block.severity ?? "",
				},
				required: policy.required,
				targets: targets.map(scanTargetSpec),
			}
		: null;
}

/**
 * Everything the worker needs to take a scanned pull through the Homerun
 * mirror: the skopeo copy and `docker load` archive commands with their auth
 * file, the mirror's refs and internal credentials, and the scan target
 * inside it. Brings the mirror up first; a failure there is handed over as
 * `unavailable`, which the worker reports before pulling directly.
 */
async function mirrorSpec(image: string, tag: string, auth?: RegistryAuth) {
	if (ImageMirrorGcService.running) {
		return { cleaningUp: true };
	}
	try {
		await DockerService.ensureImageMirror();
	} catch (err) {
		return { unavailable: err instanceof Error ? err.message : String(err) };
	}
	const refs = mirrorRefs(image, tag);
	const mirrorAuth = await DockerService.registryInternalAuth();
	const copy = skopeoCopyCommand({
		destAuth: mirrorAuth !== null,
		destination: refs.internalRef,
		source: refs.sourceRef,
		withAuth: auth !== undefined,
	});
	const authEntries = [
		...(auth
			? [
					{
						credentials: auth,
						registry: normalizeImageRef(image, tag).registry,
					},
				]
			: []),
		...(mirrorAuth
			? [
					{
						credentials: mirrorAuth,
						registry: `${MIRROR_CONTAINER_NAME}:${MIRROR_INTERNAL_PORT}`,
					},
				]
			: []),
	];
	return {
		archive: skopeoArchiveCommand({
			name: `${image}:${tag}`,
			source: refs.internalRef,
		}),
		copy: {
			...copy,
			env:
				authEntries.length > 0
					? [`${REGISTRY_AUTH_ENV}=${registryAuthFileFor(authEntries)}`]
					: [],
		},
		internalAuth: mirrorAuth,
		internalRef: refs.internalRef,
		loopbackRef: `${refs.loopbackImage}:${refs.loopbackTag}`,
		rootless: await DockerService.isRootlessDocker(),
		skopeoImage: `${SKOPEO_IMAGE}:${SKOPEO_TAG}`,
		target: scanTargetSpec({
			auth: mirrorAuth ?? undefined,
			label: MIRROR_SCAN_SOURCE,
			ref: refs.internalRef,
			source: { insecure: true, kind: "remote" },
		}),
	};
}

function buildServerSpec(server: BuildServer) {
	switch (server.kind) {
		case "docker":
			return {
				docker: {
					dockerHost: server.connection.dockerHost,
					tlsCa: server.connection.tlsCa ?? "",
					tlsCert: server.connection.tlsCert ?? "",
					tlsKey: server.connection.tlsKey ?? "",
				},
				hostId: server.hostId,
			};
		case "agent":
			return { agent: server.connection, hostId: server.hostId };
		default:
			return unreachable(server);
	}
}

/**
 * The git build part of the spec: required status checks first (they block
 * here, in the app, until they settle, then pin the commit the build checks
 * out), the provider credential, where it builds, the cache registry and the
 * scan targets for the image it ends up with.
 */
async function buildSpec(
	ctx: WorkerSpecContext,
	plan: GitBuildPlan,
	policy: ScanPolicy,
) {
	const { svc } = ctx;
	const commit = svc.toJSON().requireStatusChecks
		? await enforceStatusChecks(ctx, plan.git)
		: null;
	const built = {
		image: `homerun-build-${svc.slug}`,
		tag: Date.now().toString(36),
	};
	const registry =
		plan.kind === "local-build" ? plan.cacheRegistry : plan.registry;
	const landed =
		plan.kind !== "local-build" && plan.registry
			? publishedImageRef(plan.registry, built)
			: built;
	return {
		...built,
		build: {
			authHint: cloneFailureHint(plan.git.gitUrl, "Authentication failed"),
			commit: commit ?? "",
			credential: await resolveGitCredential(plan.git.gitUrl, ctx.userId),
			git: plan.git,
			registry,
			server: plan.kind === "local-build" ? null : buildServerSpec(plan.server),
		},
		scan: scanSpec(policy, buildScanTargets(plan, landed)),
	};
}

async function imageSpec(ctx: WorkerSpecContext, image: ImagePlan) {
	const { dep, svc } = ctx;
	const auth = DockerService.buildAuthConfig(svc);
	switch (image.kind) {
		case "pull": {
			const policy = await ImageScanService.policyFor(svc);
			if (policy.enabled) {
				await DockerService.ensureSharedNetwork();
			}
			return {
				auth: auth ?? null,
				image: image.image,
				kind: "pull",
				mirror: policy.enabled
					? await mirrorSpec(image.image, image.tag, auth)
					: null,
				pullPolicy: image.pullPolicy,
				scan: scanSpec(policy, [
					localScanTarget(`${image.image}:${image.tag}`),
				]),
				tag: image.tag,
			};
		}
		case "revision": {
			const { revision } = image;
			await dep.update({
				buildSource: revision.buildSource,
				gitCommit: revision.gitCommit,
				gitRef: revision.gitRef,
			});
			return {
				auth: auth ?? null,
				kind: "revision",
				revision: {
					...splitImageRef(revision.imageRef),
					digest: revision.digest ?? "",
					gitCommit: revision.gitCommit ?? "",
					gitRef: revision.gitRef ?? "",
					id: revision.id,
					imageId: revision.imageId ?? "",
					imageRef: revision.imageRef,
				},
			};
		}
		case "local-build":
		case "docker-build":
		case "agent-build": {
			const policy = await ImageScanService.policyFor(svc);
			if (policy.enabled) {
				await DockerService.ensureSharedNetwork();
			}
			return {
				auth: auth ?? null,
				kind: image.kind,
				...(await buildSpec(ctx, image, policy)),
			};
		}
		default:
			return unreachable(image);
	}
}

function workloadSpec(ctx: WorkerSpecContext, workload: WorkloadPlan) {
	const { mounts, stack, svc } = ctx;
	const runtime = runtimeOptionsFrom(svc.toJSON());
	const shared = {
		containerPort: svc.containerPort,
		cpuLimit: svc.cpuLimit,
		defaultDomainEnabled: svc.defaultDomainEnabled,
		dnsResolvable: svc.dnsResolvable,
		domains: svc.domains,
		envVars: {},
		healthcheckCommand: svc.healthcheckCommand,
		image: "",
		memoryLimitMb: svc.memoryLimitMb,
		portProtocol: svc.portProtocol,
		restartPolicy: svc.restartPolicy,
		runtime,
		serviceId: svc.id,
		slug: svc.slug,
		stackSlug: stack?.slug,
		tag: "",
		volumes: toVolumeParams(mounts),
	};
	const common = {
		containerPort: svc.containerPort,
		hostNetwork: workload.networkMode === "host",
		namePrefix: `homerun-${stack?.slug ? `${stack.slug}-` : ""}${svc.slug}`,
		slug: svc.slug,
	};
	switch (workload.kind) {
		case "container":
			return {
				...common,
				kind: "container",
				stackNetwork: svc.stackId ? stackNetworkName(svc.stackId) : "",
				template: containerCreateTemplate({
					...shared,
					networkMode: workload.networkMode,
					stackId: svc.stackId,
				}),
			};
		case "swarm":
			return {
				...common,
				kind: "swarm",
				overlay: swarmNetworkName(),
				privileged: runtime.privileged || runtime.devices.length > 0,
				template: swarmServiceTemplate({
					...shared,
					networkMode: workload.networkMode,
					replicas: workload.replicas,
				}),
			};
		default:
			return unreachable(workload);
	}
}

/**
 * Resolves everything the homerun worker needs to run a deploy: the image
 * source (a pull with its scan gate and mirror, a rollback's revision, or a git
 * build after its status checks), the workload's create body or swarm spec
 * with Traefik labels and runtime options, the service's env vars and env
 * files, the readiness inputs and healthchecks, and the Docker network and
 * socket paths. Secrets (registry passwords, git tokens, env values) go in it
 * as is: the job stores the spec encrypted.
 *
 * @throws `StatusChecksFailedError` when required status checks block the
 *   build, or anything a credential or mirror lookup throws.
 */
export async function deployWorkerSpec(
	ctx: WorkerSpecContext,
): Promise<Record<string, unknown>> {
	const { dep, mounts, plan, svc } = ctx;
	const runtime = runtimeOptionsFrom(svc.toJSON());
	return {
		deploymentId: dep.id,
		env: Object.entries(svc.envVars ?? {}),
		envFiles: runtime.envFiles,
		healthchecks: {
			listening: listeningHealthcheck(svc.containerPort),
			service: dockerHealthcheck(svc.healthcheckCommand) ?? null,
		},
		image: await imageSpec(ctx, plan.image),
		network: config.docker.networkName,
		readiness: {
			containerPort: svc.containerPort,
			healthcheckCommand: svc.healthcheckCommand ?? "",
			portProtocol: svc.portProtocol ?? "tcp",
			routed:
				svc.dnsResolvable !== false && plan.workload.networkMode !== "host",
		},
		serviceId: svc.id,
		socketPath: config.docker.socketPath,
		volumes: mounts.map((m) => ({ readOnly: m.mount.toJSON().readOnly })),
		workload: workloadSpec(ctx, plan.workload),
	};
}
