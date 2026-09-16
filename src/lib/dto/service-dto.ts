import {
	and,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
	type SQL,
} from "drizzle-orm";
import { SERVICE_STATUS_CONFIG, UNGROUPED_LABEL } from "$lib/constants";
import { db } from "$lib/server/db/lib";
import { type Service, service, stack } from "$lib/server/db/schema";
import {
	type ListQuery,
	narrowFilter,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import type { ContainerStatus, PullPolicy } from "$lib/types";
import { BaseDTO } from "./base-dto";

/** Fields a caller supplies to insert a new service row. */
export interface NewServiceInput {
	authRequired?: boolean;
	buildCacheRegistryId?: string | null;
	buildServerRemoteHostId?: string | null;
	buildSource?: "image" | "git";
	containerPort: number;
	cpuLimit?: string | null;
	customDomain?: string | null;
	dnsResolvable?: boolean;
	envVars: Record<string, string>;
	gitBuildContext?: string | null;
	gitDockerfilePath?: string | null;
	gitRef?: string | null;
	gitUrl?: string | null;
	gitProviderId?: string | null;
	gitRepo?: string | null;
	autoDeployOnPush?: boolean;
	healthcheckCommand?: string | null;
	image: string;
	memoryLimitMb?: number | null;
	name: string;
	networkMode?: "bridge" | "host";
	portProtocol?: "tcp" | "udp" | "both";
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
		| "customDomain"
		| "customSslCertEnc"
		| "customSslKeyEnc"
		| "desiredState"
		| "dnsResolvable"
		| "envVars"
		| "errorsDismissedAt"
		| "errorsDismissedByDeploymentId"
		| "gitBuildContext"
		| "gitDockerfilePath"
		| "gitRef"
		| "gitUrl"
		| "gitProviderId"
		| "gitRepo"
		| "autoDeployOnPush"
		| "gitWebhookId"
		| "gitWebhookSecretEnc"
		| "gitWebhookError"
		| "healthcheckCommand"
		| "image"
		| "imageScanEnabled"
		| "memoryLimitMb"
		| "name"
		| "networkMode"
		| "portProtocol"
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
>;

/**
 * Wraps the `service` table : every route that touches a service goes
 * through here instead of writing its own Drizzle query. Ownership checks
 * (`userId` match) are baked into `get`/`list`, matching the existing
 * `ownedService` convention: never trust a route param alone.
 */
export class ServiceDTO extends BaseDTO<Service> {
	/**
	 * Loads one service by id, scoped to its owner; null when missing or owned by
	 * someone else.
	 */
	static async get(id: string, userId: string): Promise<ServiceDTO | null> {
		const [row] = await db
			.select()
			.from(service)
			.where(and(eq(service.id, id), eq(service.userId, userId)))
			.limit(1);
		return row ? new ServiceDTO(row) : null;
	}

	/**
	 * Loads one service by id without an owner check, for the per-app login wall,
	 * which has to look up whichever service a request is for.
	 */
	static async getForGate(id: string): Promise<ServiceDTO | null> {
		const [row] = await db
			.select()
			.from(service)
			.where(eq(service.id, id))
			.limit(1);
		return row ? new ServiceDTO(row) : null;
	}

	/**
	 * Loads one service by id without an owner check, for an incoming git push
	 * webhook, which is authenticated by the service's own webhook secret
	 * rather than a user session.
	 */
	static async getForWebhook(id: string): Promise<ServiceDTO | null> {
		return await ServiceDTO.getForGate(id);
	}

	/** Every service the user owns, newest first. */
	static async list(userId: string): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(eq(service.userId, userId))
			.orderBy(desc(service.createdAt));
		return rows.map((row) => new ServiceDTO(row));
	}

	/** Every service the user owns in one stack, newest first. */
	static async listByStack(
		stackId: string,
		userId: string,
	): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(and(eq(service.stackId, stackId), eq(service.userId, userId)))
			.orderBy(desc(service.createdAt));
		return rows.map((row) => new ServiceDTO(row));
	}

	/**
	 * Same as `list`, plus each service's stack name (for the "Ungrouped"
	 * bucket the services list groups by) : a dedicated query rather than
	 * bolting a join onto `list`, since the two callers want different shapes.
	 */
	static async listWithStackNames(
		userId: string,
	): Promise<Array<{ stackName: string | null; service: ServiceDTO }>> {
		const rows = await db
			.select({ stackName: stack.name, row: service })
			.from(service)
			.leftJoin(stack, eq(service.stackId, stack.id))
			.where(eq(service.userId, userId))
			.orderBy(desc(service.createdAt));
		return rows.map((r) => ({
			stackName: r.stackName,
			service: new ServiceDTO(r.row),
		}));
	}

	/**
	 * Builds the WHERE clause for the paged services list : owner scope, the
	 * search box (name, slug, image, tag), status pills, and stack pills where
	 * the Ungrouped label means no stack.
	 */
	static #listFilters(userId: string, query: ListQuery): SQL | undefined {
		const conditions: SQL[] = [eq(service.userId, userId)];

		const search = searchCondition(query.q, [
			service.name,
			service.slug,
			service.image,
			service.tag,
		]);
		if (search) {
			conditions.push(search);
		}

		const statuses = narrowFilter(
			query.filters.status,
			Object.keys(SERVICE_STATUS_CONFIG) as ContainerStatus[],
		);
		if (statuses.length > 0) {
			conditions.push(inArray(service.currentStatus, statuses));
		}

		const stacks = query.filters.stack;
		if (stacks && stacks.length > 0) {
			const named = stacks.filter((p) => p !== UNGROUPED_LABEL);
			const parts: SQL[] = [];
			if (named.length > 0) {
				parts.push(inArray(stack.name, named));
			}
			if (stacks.includes(UNGROUPED_LABEL)) {
				parts.push(isNull(service.stackId));
			}
			const combined = or(...parts);
			if (combined) {
				conditions.push(combined);
			}
		}

		return and(...conditions);
	}

	/** One page of `listWithStackNames`, filtered/searched server-side, plus the unpaged total the pager needs. */
	static async listWithStackNamesPaged(
		userId: string,
		query: ListQuery,
	): Promise<PagedResult<{ stackName: string | null; service: ServiceDTO }>> {
		const where = ServiceDTO.#listFilters(userId, query);
		const [rows, totals] = await Promise.all([
			db
				.select({ stackName: stack.name, row: service })
				.from(service)
				.leftJoin(stack, eq(service.stackId, stack.id))
				.where(where)
				.orderBy(desc(service.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db
				.select({ total: count() })
				.from(service)
				.leftJoin(stack, eq(service.stackId, stack.id))
				.where(where),
		]);
		return {
			items: rows.map((r) => ({
				stackName: r.stackName,
				service: new ServiceDTO(r.row),
			})),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Every distinct status/stack this user's services actually use, for the list page's filter pills (which must stay stable regardless of the current page). */
	static async listFilterFacets(
		userId: string,
	): Promise<{ stacks: string[]; statuses: string[] }> {
		const rows = await db
			.selectDistinct({
				stackName: stack.name,
				status: service.currentStatus,
			})
			.from(service)
			.leftJoin(stack, eq(service.stackId, stack.id))
			.where(eq(service.userId, userId));
		return {
			stacks: [
				...new Set(rows.map((r) => r.stackName ?? UNGROUPED_LABEL)),
			].sort(),
			statuses: [...new Set(rows.map((r) => r.status))].sort(),
		};
	}

	/** Every service (across all users) with cron redeploys turned on : for the scheduler tick, which isn't scoped to one user. */
	static async listCronEnabled(): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(eq(service.cronEnabled, true));
		return rows.map((row) => new ServiceDTO(row));
	}

	/**
	 * Every service with a live container, for the per-minute stats sampler.
	 * Unscoped by owner deliberately, same precedent as `listCronEnabled`:
	 * this is a system-triggered sweep, not a user-facing access path.
	 */
	static async listRunningWithContainers(): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(
				and(
					isNotNull(service.containerId),
					eq(service.currentStatus, "running"),
				),
			);
		return rows.map((row) => new ServiceDTO(row));
	}

	/** Whether `customDomain` is already taken by a *different* service. */
	static async customDomainTaken(
		customDomain: string,
		excludeId?: string,
	): Promise<boolean> {
		const conditions = excludeId
			? and(eq(service.customDomain, customDomain), ne(service.id, excludeId))
			: eq(service.customDomain, customDomain);
		const [row] = await db
			.select({ id: service.id })
			.from(service)
			.where(conditions)
			.limit(1);
		return !!row;
	}

	/** Whether `slug` is already taken by a *different* service (for uniqueness checks on create/update). */
	static async slugTaken(slug: string, excludeId?: string): Promise<boolean> {
		const conditions = excludeId
			? and(eq(service.slug, slug), ne(service.id, excludeId))
			: eq(service.slug, slug);
		const [row] = await db
			.select({ id: service.id })
			.from(service)
			.where(conditions)
			.limit(1);
		return !!row;
	}

	/** Where the image comes from : registry coordinates plus the git-build fields, all optional with a default. */
	static #buildColumns(input: NewServiceInput) {
		return {
			buildCacheRegistryId: input.buildCacheRegistryId ?? null,
			buildServerRemoteHostId: input.buildServerRemoteHostId ?? null,
			buildSource: input.buildSource ?? "image",
			gitBuildContext: input.gitBuildContext ?? null,
			gitDockerfilePath: input.gitDockerfilePath ?? null,
			gitRef: input.gitRef ?? null,
			gitUrl: input.gitUrl ?? null,
			gitProviderId: input.gitProviderId ?? null,
			gitRepo: input.gitRepo ?? null,
			autoDeployOnPush: input.autoDeployOnPush ?? false,
			gitWebhookId: null,
			gitWebhookSecretEnc: null,
			gitWebhookError: null,
			registryPasswordEnc: input.registryPasswordEnc ?? null,
			registryUrl: input.registryUrl ?? null,
			registryUsername: input.registryUsername ?? null,
		} satisfies Partial<Service>;
	}

	/** How the container runs : placement, networking, resource limits, all optional with a default. */
	static #runtimeColumns(input: NewServiceInput) {
		return {
			authAllowedEmails: [],
			authAllowedGroups: [],
			authAllowedUserIds: [],
			authProviders: [],
			authRequired: input.authRequired ?? false,
			cpuLimit: input.cpuLimit ?? null,
			dnsResolvable: input.dnsResolvable ?? true,
			memoryLimitMb: input.memoryLimitMb ?? null,
			networkMode: input.networkMode ?? "bridge",
			portProtocol: input.portProtocol ?? "tcp",
			stackId: input.stackId ?? null,
			pullPolicy: input.pullPolicy ?? "always",
			replicas: input.replicas ?? 1,
		} satisfies Partial<Service>;
	}

	/**
	 * Up to `limit` of the user's services whose name, slug, image, custom domain
	 * or git URL matches `q`, newest first, for global search.
	 */
	static async search(
		userId: string,
		q: string,
		limit: number,
	): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(
				and(
					eq(service.userId, userId),
					searchCondition(q, [
						service.name,
						service.slug,
						service.image,
						service.customDomain,
						service.gitUrl,
					]),
				),
			)
			.orderBy(desc(service.createdAt))
			.limit(limit);
		return rows.map((row) => new ServiceDTO(row));
	}

	/**
	 * Inserts a new service row as pending and stopped, with cron, auto-rollback
	 * and status checks off and uptime checks and image scanning on. Nothing is
	 * deployed.
	 */
	static async create(input: NewServiceInput): Promise<ServiceDTO> {
		const now = new Date();
		const row: Service = {
			...ServiceDTO.#buildColumns(input),
			...ServiceDTO.#runtimeColumns(input),
			autoRollback: false,
			containerId: null,
			containerPort: input.containerPort,
			createdAt: now,
			cronEnabled: false,
			cronLastRunAt: null,
			cronSchedule: null,
			currentStatus: "pending",
			errorsDismissedAt: null,
			errorsDismissedByDeploymentId: null,
			customDomain: input.customDomain ?? null,
			customSslCertEnc: null,
			customSslKeyEnc: null,
			desiredState: "stopped",
			envVars: input.envVars,
			healthcheckCommand: input.healthcheckCommand ?? null,
			id: crypto.randomUUID(),
			image: input.image,
			imageScanEnabled: true,
			name: input.name,
			requireStatusChecks: false,
			requiredStatusChecks: [],
			restartPolicy: input.restartPolicy,
			slug: input.slug,
			swarmServiceId: null,
			tag: input.tag,
			uptimeEnabled: true,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(service).values(row);
		return new ServiceDTO(row);
	}

	/** Writes the given fields to the row and mirrors them onto this instance. */
	async update(input: ServiceUpdateInput): Promise<void> {
		await db.update(service).set(input).where(eq(service.id, this.row.id));
		Object.assign(this.row, input);
	}

	/**
	 * Hides every error up to now from the Observability tab, recording which
	 * deployment (if any) triggered the dismissal.
	 */
	async dismissErrors(deploymentId: string | null): Promise<void> {
		await this.update({
			errorsDismissedAt: new Date(),
			errorsDismissedByDeploymentId: deploymentId,
		});
	}

	/**
	 * Clears a container or swarm service reference that no longer exists on the
	 * host, resetting the service to pending and stopped so it can be redeployed.
	 */
	async resolveOrphan(): Promise<void> {
		await this.update({
			containerId: null,
			currentStatus: "pending",
			desiredState: "stopped",
			swarmServiceId: null,
		});
	}

	/**
	 * Row-only delete : doesn't remove the container, callers must do that first.
	 */
	async delete(): Promise<void> {
		await db.delete(service).where(eq(service.id, this.row.id));
	}

	/** The service's id. */
	get id(): string {
		return this.row.id;
	}
	/** The id of the user who owns the service. */
	get userId(): string {
		return this.row.userId;
	}
	/** The service's display name. */
	get name(): string {
		return this.row.name;
	}
	/**
	 * The unique slug, used as the `<slug>.<baseDomain>` subdomain and the
	 * internal hostname.
	 */
	get slug(): string {
		return this.row.slug;
	}
	/** The image repository, without the tag. */
	get image(): string {
		return this.row.image;
	}
	/** The image tag to deploy. */
	get tag(): string {
		return this.row.tag;
	}
	/**
	 * The live container's id in standalone mode, null when not deployed or under
	 * swarm.
	 */
	get containerId(): string | null {
		return this.row.containerId;
	}
	/** The port the app listens on inside the container. */
	get containerPort(): number {
		return this.row.containerPort;
	}
	/** The service's environment variables, empty when none are stored. */
	get envVars(): Record<string, string> {
		return this.row.envVars ?? {};
	}
	/** The container healthcheck command, if one is set. */
	get healthcheckCommand(): string | null {
		return this.row.healthcheckCommand;
	}

	/** The Docker restart policy. */
	get restartPolicy(): string {
		return this.row.restartPolicy;
	}
	/** The CPU limit in cores, null for unlimited. */
	get cpuLimit(): string | null {
		return this.row.cpuLimit;
	}
	/** The memory limit in MB, null for unlimited. */
	get memoryLimitMb(): number | null {
		return this.row.memoryLimitMb;
	}
	/** The private registry to pull the image from, if any. */
	get registryUrl(): string | null {
		return this.row.registryUrl;
	}
	/** The username for the private registry, if any. */
	get registryUsername(): string | null {
		return this.row.registryUsername;
	}
	/**
	 * The encrypted registry password, still encrypted : decrypt it only for a
	 * pull.
	 */
	get registryPasswordEnc(): string | null {
		return this.row.registryPasswordEnc;
	}
	/** Whether the user wants the service running or stopped. */
	get desiredState(): Service["desiredState"] {
		return this.row.desiredState;
	}
	/** The last observed state of the service's container. */
	get currentStatus(): Service["currentStatus"] {
		return this.row.currentStatus;
	}
	/**
	 * When the image is pulled before a deploy : always, only if missing, or
	 * never.
	 */
	get pullPolicy(): PullPolicy {
		return this.row.pullPolicy;
	}
	/** Errors from before this time are hidden on the Observability tab. */
	get errorsDismissedAt(): Date | null {
		return this.row.errorsDismissedAt;
	}
	/** The stack the service belongs to, null when ungrouped. */
	get stackId(): string | null {
		return this.row.stackId;
	}
	/**
	 * Whether Traefik routes a public hostname to the service; false keeps it
	 * internal-only.
	 */
	get dnsResolvable(): boolean {
		return this.row.dnsResolvable;
	}
	/** Whether scheduled redeploys are on. */
	get cronEnabled(): boolean {
		return this.row.cronEnabled;
	}
	/** The cron expression for scheduled redeploys, if set. */
	get cronSchedule(): string | null {
		return this.row.cronSchedule;
	}
	/** An extra hostname routed to the service, if set. */
	get customDomain(): string | null {
		return this.row.customDomain;
	}
	/**
	 * The encrypted custom TLS certificate for the custom domain, if uploaded.
	 */
	get customSslCertEnc(): string | null {
		return this.row.customSslCertEnc;
	}
	/**
	 * The encrypted custom TLS private key for the custom domain, if uploaded.
	 */
	get customSslKeyEnc(): string | null {
		return this.row.customSslKeyEnc;
	}
	/** When the last scheduled redeploy ran, null if never. */
	get cronLastRunAt(): Date | null {
		return this.row.cronLastRunAt;
	}
	/** Whether the per-app login wall guards the service. */
	get authRequired(): boolean {
		return this.row.authRequired;
	}
	/** The sign-in providers the login wall accepts. */
	get authProviders(): string[] {
		return this.row.authProviders;
	}
	/** User ids allowed through the login wall. */
	get authAllowedUserIds(): string[] {
		return this.row.authAllowedUserIds;
	}
	/** Email addresses allowed through the login wall. */
	get authAllowedEmails(): string[] {
		return this.row.authAllowedEmails;
	}
	/** Identity provider groups allowed through the login wall. */
	get authAllowedGroups(): string[] {
		return this.row.authAllowedGroups;
	}
	/** Whether the service deploys a registry image or builds from a git repo. */
	get buildSource(): Service["buildSource"] {
		return this.row.buildSource;
	}
	/** The git repository to build from, for git-built services. */
	get gitUrl(): string | null {
		return this.row.gitUrl;
	}
	/** The branch or tag to build. */
	get gitRef(): string | null {
		return this.row.gitRef;
	}
	/** The configured git provider the repo was picked from, null for a pasted URL. */
	get gitProviderId(): string | null {
		return this.row.gitProviderId;
	}
	/** The repo's path on its provider (`owner/name`, or a GitLab group path). */
	get gitRepo(): string | null {
		return this.row.gitRepo;
	}
	/** Whether a push to the service's branch deploys it. */
	get autoDeployOnPush(): boolean {
		return this.row.autoDeployOnPush;
	}
	/** The provider's id for the push webhook Homerun registered, null when none is. */
	get gitWebhookId(): string | null {
		return this.row.gitWebhookId;
	}
	/** The encrypted secret the push webhook signs its deliveries with. */
	get gitWebhookSecretEnc(): string | null {
		return this.row.gitWebhookSecretEnc;
	}
	/** Why registering the push webhook last failed, null when it didn't. */
	get gitWebhookError(): string | null {
		return this.row.gitWebhookError;
	}
	/** The build context directory inside the repo, if not the root. */
	get gitBuildContext(): string | null {
		return this.row.gitBuildContext;
	}
	/** The Dockerfile path relative to the build context, if not `Dockerfile`. */
	get gitDockerfilePath(): string | null {
		return this.row.gitDockerfilePath;
	}
	/** The registry used as a build layer cache, null for uncached builds. */
	get buildCacheRegistryId(): string | null {
		return this.row.buildCacheRegistryId;
	}
	/** The remote host builds run on, null to build locally. */
	get buildServerRemoteHostId(): string | null {
		return this.row.buildServerRemoteHostId;
	}
	/** The desired replica count, only used in swarm mode. */
	get replicas(): number {
		return this.row.replicas;
	}
	/**
	 * The Docker Swarm service id when deployed in swarm mode, otherwise null.
	 */
	get swarmServiceId(): string | null {
		return this.row.swarmServiceId;
	}

	/** Whether uptime probes run against the service. */
	get uptimeEnabled(): boolean {
		return this.row.uptimeEnabled;
	}
	/**
	 * Whether the container uses the shared bridge networks or the host's network
	 * namespace.
	 */
	get networkMode(): Service["networkMode"] {
		return this.row.networkMode;
	}
	/** Which protocol(s) the container port is exposed under. */
	get portProtocol(): Service["portProtocol"] {
		return this.row.portProtocol;
	}
	/** Whether the service's images are vulnerability-scanned. */
	get imageScanEnabled(): boolean {
		return this.row.imageScanEnabled;
	}
}
