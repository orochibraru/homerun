import { and, count, desc, eq, lt, type SQL } from "drizzle-orm";
import {
	emptyCounts,
	type ImageScanFinding,
	type ImageScanStatus,
	type SeverityCounts,
} from "$lib/image-scan";
import { db } from "$lib/server/db/lib";
import { type ImageScan, imageScan } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { BaseDTO } from "./base-dto";

const KEEP_PER_SERVICE = 25;

export interface NewImageScanInput {
	counts?: SeverityCounts;
	deploymentId?: string | null;
	digest?: string | null;
	error?: string | null;
	findings?: ImageScanFinding[];
	imageRef: string;
	serviceId: string;
	source: string;
	status: ImageScanStatus;
	totalFindings?: number;
}

export type ImageScanSummary = Omit<ImageScan, "findings">;

/**
 * Wraps the `image_scan` table : one vulnerability scan of a service's image,
 * keeping only the newest 25 per service.
 */
export class ImageScanDTO extends BaseDTO<ImageScan> {
	/**
	 * Inserts a scan result, then prunes the service's history down to its newest
	 * 25 scans.
	 */
	static async create(input: NewImageScanInput): Promise<ImageScanDTO> {
		const row: ImageScan = {
			counts: input.counts ?? emptyCounts(),
			deploymentId: input.deploymentId ?? null,
			digest: input.digest ?? null,
			error: input.error ?? null,
			findings: input.findings ?? [],
			id: crypto.randomUUID(),
			imageRef: input.imageRef,
			scannedAt: new Date(),
			serviceId: input.serviceId,
			source: input.source,
			status: input.status,
			totalFindings: input.totalFindings ?? 0,
		};
		await db.insert(imageScan).values(row);
		await ImageScanDTO.prune(input.serviceId);
		return new ImageScanDTO(row);
	}

	/** Most recent scans of one service's images, newest first. */
	static async listForService(
		serviceId: string,
		limit = 10,
	): Promise<ImageScanDTO[]> {
		const rows = await db
			.select()
			.from(imageScan)
			.where(eq(imageScan.serviceId, serviceId))
			.orderBy(desc(imageScan.scannedAt))
			.limit(limit);
		return rows.map((row) => new ImageScanDTO(row));
	}

	/**
	 * One page of a service's scans, searched by image ref, digest, status or
	 * source server-side, plus the unpaged total.
	 */
	static async listForServicePaged(
		serviceId: string,
		query: ListQuery,
	): Promise<PagedResult<ImageScanDTO>> {
		const conditions: SQL[] = [eq(imageScan.serviceId, serviceId)];
		const search = searchCondition(query.q, [
			imageScan.imageRef,
			imageScan.digest,
			imageScan.status,
			imageScan.source,
		]);
		if (search) {
			conditions.push(search);
		}
		const where = and(...conditions);
		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(imageScan)
				.where(where)
				.orderBy(desc(imageScan.scannedAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(imageScan).where(where),
		]);
		return {
			items: rows.map((row) => new ImageScanDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Loads one scan by id only if it belongs to the given service. */
	static async getForService(
		serviceId: string,
		scanId: string,
	): Promise<ImageScanDTO | null> {
		const [row] = await db
			.select()
			.from(imageScan)
			.where(and(eq(imageScan.serviceId, serviceId), eq(imageScan.id, scanId)))
			.limit(1);
		return row ? new ImageScanDTO(row) : null;
	}

	/** The service's newest scan, null when it has never been scanned. */
	static async latestForService(
		serviceId: string,
	): Promise<ImageScanDTO | null> {
		const [latest] = await ImageScanDTO.listForService(serviceId, 1);
		return latest ?? null;
	}

	/** Deletes everything but the service's newest 25 scans. */
	static async prune(serviceId: string): Promise<void> {
		const [cutoff] = await db
			.select({ scannedAt: imageScan.scannedAt })
			.from(imageScan)
			.where(eq(imageScan.serviceId, serviceId))
			.orderBy(desc(imageScan.scannedAt))
			.limit(1)
			.offset(KEEP_PER_SERVICE - 1);
		if (!cutoff) {
			return;
		}
		await db
			.delete(imageScan)
			.where(
				and(
					eq(imageScan.serviceId, serviceId),
					lt(imageScan.scannedAt, cutoff.scannedAt),
				),
			);
	}

	/** The scan's id. */
	get id(): string {
		return this.row.id;
	}

	/** Finding counts per severity. */
	get counts(): SeverityCounts {
		return this.row.counts;
	}

	/**
	 * The row without its (potentially large) findings list, for list views and
	 * API responses.
	 */
	toSummary(): ImageScanSummary {
		const { findings: _findings, ...summary } = this.row;
		return summary;
	}
}
