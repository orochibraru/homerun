import type { BuildMethod } from "$lib/build-methods";
import type { RemoteExecutionTarget } from "$lib/dto/remote-host-dto";
import type { Service } from "$lib/server/db/schema";
import type { PullPolicy } from "$lib/types";

export interface CacheRegistryCredentials {
	password: string;
	registryUrl: string;
	username: string;
}

export type BuildServer = Exclude<RemoteExecutionTarget, { kind: "local" }>;

export interface GitSource {
	bakeFile: string | null;
	bakeTarget: string | null;
	buildContext: string | null;
	buildMethod: BuildMethod;
	dockerfilePath: string | null;
	gitRef: string | null;
	gitUrl: string;
}

export interface RevisionSource {
	buildSource: "image" | "git";
	digest: string | null;
	gitCommit: string | null;
	gitRef: string | null;
	id: string;
	imageId: string | null;
	imageRef: string;
}

export type ImagePlan =
	| { image: string; kind: "pull"; pullPolicy: PullPolicy; tag: string }
	| { kind: "revision"; revision: RevisionSource }
	| {
			cacheRegistry: CacheRegistryCredentials | null;
			git: GitSource;
			kind: "local-build";
	  }
	| {
			git: GitSource;
			kind: "docker-build";
			registry: CacheRegistryCredentials | null;
			server: Extract<BuildServer, { kind: "docker" }>;
	  }
	| {
			git: GitSource;
			kind: "agent-build";
			registry: CacheRegistryCredentials | null;
			server: Extract<BuildServer, { kind: "agent" }>;
	  };

export type GitBuildPlan = Exclude<ImagePlan, { kind: "pull" | "revision" }>;

export type WorkloadPlan =
	| { kind: "container"; networkMode: Service["networkMode"] }
	| {
			kind: "swarm";
			networkMode: Service["networkMode"];
			replicas: number;
	  };

export interface DeployPlan {
	image: ImagePlan;
	workload: WorkloadPlan;
}

export type DeployPlanService = Pick<
	Service,
	| "buildServerRemoteHostId"
	| "buildSource"
	| "gitBakeFile"
	| "gitBakeTarget"
	| "gitBuildContext"
	| "gitBuildMethod"
	| "gitDockerfilePath"
	| "gitRef"
	| "gitUrl"
	| "image"
	| "networkMode"
	| "pullPolicy"
	| "replicas"
	| "tag"
>;

export interface DeployPlanInput {
	buildServer: BuildServer | null;
	cacheRegistry: CacheRegistryCredentials | null;
	orchestrationMode: "standalone" | "swarm";
	revision?: RevisionSource | null;
	service: DeployPlanService;
}

export class DeployPlanError extends Error {
	override name = "DeployPlanError";
}

/**
 * Exhaustiveness helper for the discriminated-union switches over
 * `ImagePlan`/`WorkloadPlan` variants : a `default` branch calling this with
 * the switched-on value makes TypeScript flag any variant left unhandled at
 * compile time, and throws if one somehow reaches here at runtime anyway.
 */
export function unreachable(value: never): never {
	throw new Error(`Unhandled deploy plan variant: ${JSON.stringify(value)}`);
}

/**
 * Builds the `GitBuildPlan` for a `buildSource: "git"` service : a local
 * build when no build server is configured, otherwise a docker-remote or
 * agent build depending on the build server's kind, publishing through the
 * configured cache registry when there is one, or streaming the image back to
 * this host (`registry: null`) when there isn't.
 *
 * @throws When the service has no `gitUrl`, or when the configured build
 *   server id doesn't resolve to one.
 */
function resolveGitBuild(input: DeployPlanInput): GitBuildPlan {
	const { buildServer, cacheRegistry, service } = input;
	if (!service.gitUrl) {
		throw new DeployPlanError("No git repository URL configured.");
	}
	const git: GitSource = {
		bakeFile: service.gitBakeFile,
		bakeTarget: service.gitBakeTarget,
		buildContext: service.gitBuildContext,
		buildMethod: service.gitBuildMethod,
		dockerfilePath: service.gitDockerfilePath,
		gitRef: service.gitRef,
		gitUrl: service.gitUrl,
	};

	if (!service.buildServerRemoteHostId) {
		return { cacheRegistry, git, kind: "local-build" };
	}
	if (!buildServer) {
		throw new DeployPlanError(
			`Build server ${service.buildServerRemoteHostId} not found.`,
		);
	}
	switch (buildServer.kind) {
		case "docker":
			return {
				git,
				kind: "docker-build",
				registry: cacheRegistry,
				server: buildServer,
			};
		case "agent":
			return {
				git,
				kind: "agent-build",
				registry: cacheRegistry,
				server: buildServer,
			};
		default:
			return unreachable(buildServer);
	}
}

/**
 * Picks the `ImagePlan` variant for a deploy : a rollback's revision when
 * `input.revision` is set, otherwise a registry pull or a git build
 * depending on the service's own `buildSource`.
 *
 * @throws When `buildSource` is `"image"` but the service has no `image`
 *   configured, or via `resolveGitBuild`'s own checks for the git path.
 */
function resolveImage(input: DeployPlanInput): ImagePlan {
	const { revision, service } = input;
	if (revision) {
		return { kind: "revision", revision };
	}
	switch (service.buildSource) {
		case "image":
			if (!service.image) {
				throw new DeployPlanError("No image configured.");
			}
			return {
				image: service.image,
				kind: "pull",
				pullPolicy: service.pullPolicy,
				tag: service.tag,
			};
		case "git":
			return resolveGitBuild(input);
		default:
			return unreachable(service.buildSource);
	}
}

function resolveWorkload(input: DeployPlanInput): WorkloadPlan {
	const { orchestrationMode, service } = input;
	switch (orchestrationMode) {
		case "standalone":
			return { kind: "container", networkMode: service.networkMode };
		case "swarm":
			return {
				kind: "swarm",
				networkMode: service.networkMode,
				replicas: service.replicas,
			};
		default:
			return unreachable(orchestrationMode);
	}
}

/**
 * Entry point for the deploy pipeline's planning step : combines the image
 * source decision (`resolveImage`) and the workload shape decision
 * (`resolveWorkload`, standalone container vs. swarm service) into one
 * `DeployPlan` for `deploy.service.ts` to execute.
 *
 * @throws Via `resolveImage`, e.g. a misconfigured build server or a missing
 *   image.
 */
export function resolveDeployPlan(input: DeployPlanInput): DeployPlan {
	return { image: resolveImage(input), workload: resolveWorkload(input) };
}
