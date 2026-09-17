import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { ServiceDTO } from "./service-dto";

/**
 * The `service` finders behind push polling, webhook retries and pull request
 * previews, kept apart from `ServiceDTO` so that one stays readable. It
 * extends `ServiceDTO` only to build its rows, every result is used as a
 * plain `ServiceDTO`.
 */
export class ServiceGitDTO extends ServiceDTO {
	/**
	 * Every git service that deploys on push and needs its branch polled:
	 * polling is turned on for it, or Homerun couldn't register its webhook.
	 * Pull request previews are never polled.
	 */
	static async listPushPollable(): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(
				and(
					eq(service.buildSource, "git"),
					eq(service.autoDeployOnPush, true),
					isNull(service.previewParentId),
					or(eq(service.gitPollEnabled, true), isNull(service.gitWebhookId)),
				),
			);
		return rows.map((row) => new ServiceGitDTO(row));
	}

	/** The pull request previews of a service, newest pull request first. */
	static async listPreviews(parentId: string): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(eq(service.previewParentId, parentId))
			.orderBy(desc(service.previewPrNumber));
		return rows.map((row) => new ServiceGitDTO(row));
	}

	/** The preview of pull request `prNumber` on a service, null when there's none. */
	static async getPreview(
		parentId: string,
		prNumber: number,
	): Promise<ServiceDTO | null> {
		const [row] = await db
			.select()
			.from(service)
			.where(
				and(
					eq(service.previewParentId, parentId),
					eq(service.previewPrNumber, prNumber),
				),
			)
			.limit(1);
		return row ? new ServiceGitDTO(row) : null;
	}

	/**
	 * The git services a user owns on one provider whose webhook isn't
	 * registered although deploy on push or previews want one, to retry once
	 * that user reconnects the provider.
	 */
	static async listAwaitingWebhook(
		userId: string,
		providerId: string,
	): Promise<ServiceDTO[]> {
		const rows = await db
			.select()
			.from(service)
			.where(
				and(
					eq(service.userId, userId),
					eq(service.gitProviderId, providerId),
					eq(service.buildSource, "git"),
					isNull(service.gitWebhookId),
					or(
						eq(service.autoDeployOnPush, true),
						eq(service.previewsEnabled, true),
					),
				),
			);
		return rows.map((row) => new ServiceGitDTO(row));
	}
}
