import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { imageScan, service } from "$lib/server/db/schema";
import { MIRROR_SCAN_SOURCE } from "$lib/services/docker/image-scan-refs";
import type {
	ImageDigestRef,
	ServiceMirrorReference,
} from "$lib/services/docker/mirror-registry";
import { DeploymentDTO } from "./deployment-dto";

function groupByService(
	rows: Array<ImageDigestRef & { serviceId: string }>,
): Map<string, ImageDigestRef[]> {
	const grouped = new Map<string, ImageDigestRef[]>();
	for (const row of rows) {
		const list = grouped.get(row.serviceId) ?? [];
		list.push({ digest: row.digest, imageRef: row.imageRef });
		grouped.set(row.serviceId, list);
	}
	return grouped;
}

export async function listMirrorReferences(): Promise<
	ServiceMirrorReference[]
> {
	const [services, scans, revisions] = await Promise.all([
		db
			.select({ id: service.id, image: service.image, tag: service.tag })
			.from(service),
		db
			.select({
				digest: imageScan.digest,
				imageRef: imageScan.imageRef,
				serviceId: imageScan.serviceId,
			})
			.from(imageScan)
			.where(
				and(
					eq(imageScan.source, MIRROR_SCAN_SOURCE),
					isNotNull(imageScan.digest),
				),
			)
			.orderBy(desc(imageScan.scannedAt)),
		DeploymentDTO.listRetainedRevisions(),
	]);

	const scansByService = groupByService(
		scans.flatMap((scan) =>
			scan.digest
				? [
						{
							digest: scan.digest,
							imageRef: scan.imageRef,
							serviceId: scan.serviceId,
						},
					]
				: [],
		),
	);
	const revisionsByService = groupByService(
		revisions.flatMap((revision) =>
			revision.imageDigest && revision.imageRef
				? [
						{
							digest: revision.imageDigest,
							imageRef: revision.imageRef,
							serviceId: revision.serviceId,
						},
					]
				: [],
		),
	);

	return services.map((row) => ({
		deployed: revisionsByService.get(row.id) ?? [],
		image: row.image,
		scans: scansByService.get(row.id) ?? [],
		tag: row.tag,
	}));
}
