import { and, desc, eq, lt } from "drizzle-orm";
import {
	emptyCounts,
	type ImageScanFinding,
	type ImageScanStatus,
	type SeverityCounts,
} from "$lib/image-scan";
import { db } from "$lib/server/db/lib";
import { type ImageScan, imageScan } from "$lib/server/db/schema";
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

export class ImageScanDTO extends BaseDTO<ImageScan> {
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

	get id(): string {
		return this.row.id;
	}

	get counts(): SeverityCounts {
		return this.row.counts;
	}
}
