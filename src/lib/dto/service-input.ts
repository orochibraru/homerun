import type { BuildMethod } from "$lib/build-methods";
import type { PublishedPort } from "$lib/published-ports";
import type { Service } from "$lib/server/db/schema";
import type { runtimeOptionsFrom } from "$lib/service-runtime";
import type { PullPolicy } from "$lib/types";

/** Fields a caller supplies to insert a new service row. */
export interface NewServiceInput {
	authRequired?: boolean;
	/** Off by default for a database or cache image, which has no HTTP to probe and no public route to watch. */
	uptimeEnabled?: boolean;
	buildCacheRegistryId?: string | null;
	buildServerRemoteHostId?: string | null;
	buildSource?: "image" | "git";
	containerPort: number;
	cpuLimit?: string | null;
	dnsResolvable?: boolean;
	domains?: string[];
	envVars: Record<string, string>;
	gitBakeFile?: string | null;
	gitBakeTarget?: string | null;
	gitBuildContext?: string | null;
	gitBuildMethod?: BuildMethod;
	gitDockerfilePath?: string | null;
	gitRef?: string | null;
	gitUrl?: string | null;
	gitProviderId?: string | null;
	gitRepo?: string | null;
	autoDeployOnPush?: boolean;
	healthcheckCommand?: string | null;
	previewBranch?: string | null;
	previewParentId?: string | null;
	previewPrNumber?: number | null;
	previewPrTitle?: string | null;
	image: string;
	runtime?: Parameters<typeof runtimeOptionsFrom>[0];
	memoryLimitMb?: number | null;
	name: string;
	networkMode?: "bridge" | "host";
	portProtocol?: "tcp" | "udp" | "both";
	publishedPorts?: PublishedPort[];
	category?: string | null;
	icon?: string | null;
	stackId?: string | null;
	registryPasswordEnc?: string | null;
	registryUrl?: string | null;
	registryUsername?: string | null;
	pullPolicy?: PullPolicy;
	replicas?: number;
	restartPolicy: string;
	slug: string;
	tag: string;
	userId: string;
}

/** Fields a caller may patch on an existing service row. */
export type ServiceUpdateInput = Partial<
	Pick<
		Service,
		| "authAllowedEmails"
		| "authAllowedGroups"
		| "authAllowedUserIds"
		| "authProviders"
		| "authRequired"
		| "autoRollback"
		| "buildCacheRegistryId"
		| "buildServerRemoteHostId"
		| "buildSource"
		| "containerId"
		| "containerPort"
		| "cpuLimit"
		| "cronEnabled"
		| "cronLastRunAt"
		| "cronSchedule"
		| "currentStatus"
		| "defaultDomainEnabled"
		| "domains"
		| "primaryDomain"
		| "customSslCertEnc"
		| "customSslKeyEnc"
		| "desiredState"
		| "dnsResolvable"
		| "envVars"
		| "errorsDismissedAt"
		| "errorsDismissedByDeploymentId"
		| "gitBakeFile"
		| "gitBakeTarget"
		| "gitBuildContext"
		| "gitBuildMethod"
		| "gitDockerfilePath"
		| "gitRef"
		| "gitUrl"
		| "gitProviderId"
		| "gitRepo"
		| "autoDeployOnPush"
		| "gitWebhookId"
		| "gitWebhookSecretEnc"
		| "gitWebhookError"
		| "gitWebhookReconnect"
		| "gitPollEnabled"
		| "gitLastSeenCommit"
		| "previewsEnabled"
		| "previewPrTitle"
		| "previewBranch"
		| "healthcheckCommand"
		| "image"
		| "imageScanEnabled"
		| "memoryLimitMb"
		| "name"
		| "networkMode"
		| "portProtocol"
		| "category"
		| "httpCacheTtl"
		| "icon"
		| "domainPorts"
		| "publishedPorts"
		| "stackId"
		| "pullPolicy"
		| "registryPasswordEnc"
		| "registryUrl"
		| "registryUsername"
		| "replicas"
		| "requireStatusChecks"
		| "requiredStatusChecks"
		| "restartPolicy"
		| "slug"
		| "swarmServiceId"
		| "uptimeEnabled"
		| "tag"
	>
> &
	Parameters<typeof runtimeOptionsFrom>[0];
