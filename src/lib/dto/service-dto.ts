import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { project, type Service, service } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

/** Fields a caller supplies to insert a new service row. */
export interface NewServiceInput {
	authRequired?: boolean;
	autoscaleEligible?: boolean;
	buildCacheRegistryId?: string | null;
	buildServerRemoteHostId?: string | null;
	buildSource?: "image" | "git";
	containerPort: number;
	cpuLimit?: string | null;
	dnsResolvable?: boolean;
	envVars: Record<string, string>;
	gitBuildContext?: string | null;
	gitDockerfilePath?: string | null;
	gitRef?: string | null;
	gitUrl?: string | null;
	image: string;
	memoryLimitMb?: number | null;
	name: string;
	networkMode?: "bridge" | "host";
	portProtocol?: "tcp" | "udp" | "both";
	projectId?: string | null;
	registryPasswordEnc?: string | null;
	registryUrl?: string | null;
	registryUsername?: string | null;
	remoteHostId?: string | null;
	restartPolicy: string;
	slug: string;
	tag: string;
	userId: string;
}

/** Fields a caller may patch on an existing service row. */
export type ServiceUpdateInput = Partial<
	Pick<
		Service,
		| "authRequired"
		| "autoscaleEligible"
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
		| "gitBuildContext"
		| "gitDockerfilePath"
		| "gitRef"
		| "gitUrl"
		| "image"
		| "memoryLimitMb"
		| "name"
		| "networkMode"
		| "portProtocol"
		| "projectId"
		| "registryPasswordEnc"
		| "registryUrl"
		| "registryUsername"
		| "remoteHostId"
		| "restartPolicy"
		| "slug"
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
	static async get(id: string, userId: string): Promise<ServiceDTO | null> {
		const [row] = await db
			.select()
			.from(service)
			.where(and(eq(service.id, id), eq(service.userId, userId)))
			.limit(1);
		return row ? new ServiceDTO(row) : null;
	}

	static async list(userId: string): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(eq(service.userId, userId))
			.orderBy(desc(service.createdAt));
		return rows.map((row) => new ServiceDTO(row));
	}

	static async listByProject(
		projectId: string,
		userId: string,
	): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(and(eq(service.projectId, projectId), eq(service.userId, userId)))
			.orderBy(desc(service.createdAt));
		return rows.map((row) => new ServiceDTO(row));
	}

	/**
	 * Same as `list`, plus each service's project name (for the "Ungrouped"
	 * bucket the services list groups by) : a dedicated query rather than
	 * bolting a join onto `list`, since the two callers want different shapes.
	 */
	static async listWithProjectNames(
		userId: string,
	): Promise<Array<{ projectName: string | null; service: ServiceDTO }>> {
		const rows = await db
			.select({ projectName: project.name, row: service })
			.from(service)
			.leftJoin(project, eq(service.projectId, project.id))
			.where(eq(service.userId, userId))
			.orderBy(desc(service.createdAt));
		return rows.map((r) => ({
			projectName: r.projectName,
			service: new ServiceDTO(r.row),
		}));
	}

	/** Every service (across all users) with cron redeploys turned on : for the scheduler tick, which isn't scoped to one user. */
	static async listCronEnabled(): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(eq(service.cronEnabled, true));
		return rows.map((row) => new ServiceDTO(row));
	}

	/** Every autoscale-eligible service (across all users) currently on the local host : for CronService's autoscale tick, which isn't scoped to one user. */
	static async listAutoscaleEligibleOnLocalHost(): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(
				and(
					eq(service.autoscaleEligible, true),
					isNull(service.remoteHostId),
					eq(service.desiredState, "running"),
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

	static async create(input: NewServiceInput): Promise<ServiceDTO> {
		const now = new Date();
		const row: Service = {
			authRequired: input.authRequired ?? false,
			autoscaleEligible: input.autoscaleEligible ?? false,
			buildCacheRegistryId: input.buildCacheRegistryId ?? null,
			buildServerRemoteHostId: input.buildServerRemoteHostId ?? null,
			buildSource: input.buildSource ?? "image",
			containerId: null,
			containerPort: input.containerPort,
			cpuLimit: input.cpuLimit ?? null,
			createdAt: now,
			cronEnabled: false,
			cronLastRunAt: null,
			cronSchedule: null,
			currentStatus: "pending",
			customDomain: null,
			customSslCertEnc: null,
			customSslKeyEnc: null,
			desiredState: "stopped",
			dnsResolvable: input.dnsResolvable ?? true,
			envVars: input.envVars,
			gitBuildContext: input.gitBuildContext ?? null,
			gitDockerfilePath: input.gitDockerfilePath ?? null,
			gitRef: input.gitRef ?? null,
			gitUrl: input.gitUrl ?? null,
			id: crypto.randomUUID(),
			image: input.image,
			memoryLimitMb: input.memoryLimitMb ?? null,
			name: input.name,
			networkMode: input.networkMode ?? "bridge",
			portProtocol: input.portProtocol ?? "tcp",
			projectId: input.projectId ?? null,
			registryPasswordEnc: input.registryPasswordEnc ?? null,
			registryUrl: input.registryUrl ?? null,
			registryUsername: input.registryUsername ?? null,
			remoteHostId: input.remoteHostId ?? null,
			restartPolicy: input.restartPolicy,
			slug: input.slug,
			tag: input.tag,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(service).values(row);
		return new ServiceDTO(row);
	}

	async update(input: ServiceUpdateInput): Promise<void> {
		await db.update(service).set(input).where(eq(service.id, this.row.id));
		Object.assign(this.row, input);
	}

	async delete(): Promise<void> {
		await db.delete(service).where(eq(service.id, this.row.id));
	}

	get id(): string {
		return this.row.id;
	}
	get userId(): string {
		return this.row.userId;
	}
	get name(): string {
		return this.row.name;
	}
	get slug(): string {
		return this.row.slug;
	}
	get image(): string {
		return this.row.image;
	}
	get tag(): string {
		return this.row.tag;
	}
	get containerId(): string | null {
		return this.row.containerId;
	}
	get containerPort(): number {
		return this.row.containerPort;
	}
	get envVars(): Record<string, string> {
		return this.row.envVars ?? {};
	}
	get restartPolicy(): string {
		return this.row.restartPolicy;
	}
	get cpuLimit(): string | null {
		return this.row.cpuLimit;
	}
	get memoryLimitMb(): number | null {
		return this.row.memoryLimitMb;
	}
	get registryUrl(): string | null {
		return this.row.registryUrl;
	}
	get registryUsername(): string | null {
		return this.row.registryUsername;
	}
	get registryPasswordEnc(): string | null {
		return this.row.registryPasswordEnc;
	}
	get desiredState(): Service["desiredState"] {
		return this.row.desiredState;
	}
	get currentStatus(): Service["currentStatus"] {
		return this.row.currentStatus;
	}
	get projectId(): string | null {
		return this.row.projectId;
	}
	get dnsResolvable(): boolean {
		return this.row.dnsResolvable;
	}
	get cronEnabled(): boolean {
		return this.row.cronEnabled;
	}
	get cronSchedule(): string | null {
		return this.row.cronSchedule;
	}
	get customDomain(): string | null {
		return this.row.customDomain;
	}
	get customSslCertEnc(): string | null {
		return this.row.customSslCertEnc;
	}
	get customSslKeyEnc(): string | null {
		return this.row.customSslKeyEnc;
	}
	get cronLastRunAt(): Date | null {
		return this.row.cronLastRunAt;
	}
	get authRequired(): boolean {
		return this.row.authRequired;
	}
	get autoscaleEligible(): boolean {
		return this.row.autoscaleEligible;
	}
	get buildSource(): Service["buildSource"] {
		return this.row.buildSource;
	}
	get gitUrl(): string | null {
		return this.row.gitUrl;
	}
	get gitRef(): string | null {
		return this.row.gitRef;
	}
	get gitBuildContext(): string | null {
		return this.row.gitBuildContext;
	}
	get gitDockerfilePath(): string | null {
		return this.row.gitDockerfilePath;
	}
	get buildCacheRegistryId(): string | null {
		return this.row.buildCacheRegistryId;
	}
	get buildServerRemoteHostId(): string | null {
		return this.row.buildServerRemoteHostId;
	}
	get remoteHostId(): string | null {
		return this.row.remoteHostId;
	}
	get networkMode(): Service["networkMode"] {
		return this.row.networkMode;
	}
	get portProtocol(): Service["portProtocol"] {
		return this.row.portProtocol;
	}
}
