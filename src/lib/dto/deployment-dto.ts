import { desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type Deployment, deployment, service } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface NewDeploymentInput {
  serviceId: string;
  status: Deployment["status"];
  userId: string;
}

export type DeploymentUpdateInput = Partial<
  Pick<
    Deployment,
    "containerId" | "errorMessage" | "finishedAt" | "imageDigest" | "status"
  >
>;

/** Wraps the `deployment` table — see ServiceDTO for the pattern this follows. */
export class DeploymentDTO extends BaseDTO<Deployment> {
  static async listForService(
    serviceId: string,
    limit = 10
  ): Promise<DeploymentDTO[]> {
    const rows = await db
      .select()
      .from(deployment)
      .where(eq(deployment.serviceId, serviceId))
      .orderBy(desc(deployment.createdAt))
      .limit(limit);
    return rows.map((row) => new DeploymentDTO(row));
  }

  /** Same as `listForService`, scoped to a user across all their services — plus each row's service name/slug, for the dashboard. */
  static async listRecentForUser(
    userId: string,
    limit = 5
  ): Promise<
    Array<{
      deployment: DeploymentDTO;
      serviceName: string | null;
      serviceSlug: string | null;
    }>
  > {
    const rows = await db
      .select({
        row: deployment,
        serviceName: service.name,
        serviceSlug: service.slug,
      })
      .from(deployment)
      .leftJoin(service, eq(deployment.serviceId, service.id))
      .where(eq(deployment.userId, userId))
      .orderBy(desc(deployment.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      deployment: new DeploymentDTO(r.row),
      serviceName: r.serviceName,
      serviceSlug: r.serviceSlug,
    }));
  }

  static async create(input: NewDeploymentInput): Promise<DeploymentDTO> {
    const now = new Date();
    const row: Deployment = {
      containerId: null,
      createdAt: now,
      errorMessage: null,
      finishedAt: null,
      id: crypto.randomUUID(),
      imageDigest: null,
      serviceId: input.serviceId,
      startedAt: now,
      status: input.status,
      userId: input.userId,
    };
    await db.insert(deployment).values(row);
    return new DeploymentDTO(row);
  }

  async update(input: DeploymentUpdateInput): Promise<void> {
    await db
      .update(deployment)
      .set(input)
      .where(eq(deployment.id, this.row.id));
    Object.assign(this.row, input);
  }

  get id(): string {
    return this.row.id;
  }
}
