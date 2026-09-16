import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { deployment, imageScan, service } from "$lib/server/db/schema";
import { MIRROR_SCAN_SOURCE } from "$lib/services/docker/image-scan-refs";
import type {
	ImageDigestRef,
	ServiceMirrorReference,
} from "$lib/services/docker/mirror-registry";

export async function listMirrorReferences(): Promise<
	ServiceMirrorReference[]
> {
	const [services, scans, deployments] = await Promise.all([
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
		db
			.selectDistinctOn([deployment.serviceId], {
				digest: deployment.imageDigest,
				imageRef: deployment.imageRef,
				serviceId: deployment.serviceId,
			})
			.from(deployment)
			.where(
				and(
					isNotNull(deployment.imageDigest),
					isNotNull(deployment.imageRef),
					inArray(deployment.status, ["running", "stopped"]),
				),
			)
			.orderBy(deployment.serviceId, desc(deployment.createdAt)),
	]);

	const scansByService = new Map<string, ImageDigestRef[]>();
	for (const scan of scans) {
		if (!scan.digest) {
			continue;
		}
		const list = scansByService.get(scan.serviceId) ?? [];
		list.push({ digest: scan.digest, imageRef: scan.imageRef });
		scansByService.set(scan.serviceId, list);
	}
	const deployedByService = new Map(
		deployments.map((row) => [row.serviceId, row]),
	);

	return services.map((row) => {
		const deployed = deployedByService.get(row.id);
		return {
			deployed:
				deployed?.digest && deployed.imageRef
					? { digest: deployed.digest, imageRef: deployed.imageRef }
					: null,
			image: row.image,
			scans: scansByService.get(row.id) ?? [],
			tag: row.tag,
		};
	});
}
