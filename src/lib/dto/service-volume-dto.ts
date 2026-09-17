import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type ServiceVolume,
	serviceVolume,
	storageVolume,
} from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface NewServiceVolumeInput {
	containerPath: string;
	readOnly: boolean;
	serviceId: string;
	volumeId: string;
}

/** Wraps the `service_volume` join table : a mount of one StorageVolume into one service. */
export class ServiceVolumeDTO extends BaseDTO<ServiceVolume> {
	/** Every mount on a service, plus the underlying volume's name/kind/source for display and for building Docker Binds at deploy time. */
	static async listForService(serviceId: string): Promise<
		Array<{
			mount: ServiceVolumeDTO;
			volumeKind: string;
			volumeName: string;
			volumeSource: string;
		}>
	> {
		const rows = await db
			.select({
				row: serviceVolume,
				volumeKind: storageVolume.kind,
				volumeName: storageVolume.name,
				volumeSource: storageVolume.source,
			})
			.from(serviceVolume)
			.innerJoin(storageVolume, eq(serviceVolume.volumeId, storageVolume.id))
			.where(eq(serviceVolume.serviceId, serviceId));
		return rows.map((r) => ({
			mount: new ServiceVolumeDTO(r.row),
			volumeKind: r.volumeKind,
			volumeName: r.volumeName,
			volumeSource: r.volumeSource,
		}));
	}

	/** The distinct ids of every service a storage volume is mounted into, for stopping them around a backup or restore of it. */
	static async serviceIdsForVolume(volumeId: string): Promise<string[]> {
		const rows = await db
			.selectDistinct({ serviceId: serviceVolume.serviceId })
			.from(serviceVolume)
			.where(eq(serviceVolume.volumeId, volumeId));
		return rows.map((row) => row.serviceId);
	}

	/**
	 * The Docker volume name of every named storage volume mounted into at
	 * least one service, across every user : what Docker Cleanup must never
	 * prune, whether or not that service currently has a container.
	 */
	static async mountedVolumeNames(): Promise<string[]> {
		const rows = await db
			.selectDistinct({ source: storageVolume.source })
			.from(serviceVolume)
			.innerJoin(
				storageVolume,
				and(
					eq(serviceVolume.volumeId, storageVolume.id),
					eq(storageVolume.kind, "volume"),
				),
			);
		return rows.map((row) => row.source);
	}

	/**
	 * Mounts a storage volume into a service at `containerPath`; takes effect on
	 * the service's next deploy.
	 */
	static async attach(input: NewServiceVolumeInput): Promise<ServiceVolumeDTO> {
		const row: ServiceVolume = {
			containerPath: input.containerPath,
			createdAt: new Date(),
			id: crypto.randomUUID(),
			readOnly: input.readOnly,
			serviceId: input.serviceId,
			volumeId: input.volumeId,
		};
		await db.insert(serviceVolume).values(row);
		return new ServiceVolumeDTO(row);
	}

	/**
	 * Deletes this mount row; the running container keeps it until the next
	 * deploy.
	 */
	async detach(): Promise<void> {
		await db.delete(serviceVolume).where(eq(serviceVolume.id, this.row.id));
	}

	/** The mount's id. */
	get id(): string {
		return this.row.id;
	}
	/** The id of the service the volume is mounted into. */
	get serviceId(): string {
		return this.row.serviceId;
	}
}
