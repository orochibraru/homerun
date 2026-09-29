import { and, eq } from "drizzle-orm";
import type { VolumeMountSnapshot } from "$lib/revision-config";
import { db } from "$lib/server/db/lib";
import {
	type ServiceVolume,
	service,
	serviceVolume,
	storageVolume,
} from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface VolumeUser {
	serviceId: string;
	serviceName: string;
	stackId: string | null;
}

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
			volumeSeedFrom: string | null;
			volumeSource: string;
		}>
	> {
		const rows = await db
			.select({
				row: serviceVolume,
				volumeKind: storageVolume.kind,
				volumeName: storageVolume.name,
				volumeSeedFrom: storageVolume.seedFrom,
				volumeSource: storageVolume.source,
			})
			.from(serviceVolume)
			.innerJoin(storageVolume, eq(serviceVolume.volumeId, storageVolume.id))
			.where(eq(serviceVolume.serviceId, serviceId));
		return rows.map((r) => ({
			mount: new ServiceVolumeDTO(r.row),
			volumeKind: r.volumeKind,
			volumeName: r.volumeName,
			volumeSeedFrom: r.volumeSeedFrom,
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

	/** Every service each storage volume is mounted into, keyed by volume id, with the service's stack for showing where a volume comes from. */
	static async usersByVolume(): Promise<Map<string, VolumeUser[]>> {
		const rows = await db
			.selectDistinct({
				serviceId: service.id,
				serviceName: service.name,
				stackId: service.stackId,
				volumeId: serviceVolume.volumeId,
			})
			.from(serviceVolume)
			.innerJoin(service, eq(serviceVolume.serviceId, service.id))
			.orderBy(service.name);
		const users = new Map<string, VolumeUser[]>();
		for (const { volumeId, ...user } of rows) {
			users.set(volumeId, [...(users.get(volumeId) ?? []), user]);
		}
		return users;
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
	 * Points every mount of `from` in a service at `to` instead, same path and
	 * mode: how a backup restored into a new volume replaces the old one.
	 *
	 * @returns How many mounts moved.
	 */
	static async swapVolume(
		serviceId: string,
		from: string,
		to: string,
	): Promise<number> {
		const moved = await db
			.update(serviceVolume)
			.set({ volumeId: to })
			.where(
				and(
					eq(serviceVolume.serviceId, serviceId),
					eq(serviceVolume.volumeId, from),
				),
			)
			.returning({ id: serviceVolume.id });
		return moved.length;
	}

	/**
	 * Replaces a service's mounts with `mounts`, as a revision recorded them,
	 * in one transaction; takes effect on the deploy that's running it.
	 */
	static async replaceForService(
		serviceId: string,
		mounts: VolumeMountSnapshot[],
	): Promise<void> {
		await db.transaction(async (tx) => {
			await tx
				.delete(serviceVolume)
				.where(eq(serviceVolume.serviceId, serviceId));
			if (mounts.length > 0) {
				await tx.insert(serviceVolume).values(
					mounts.map((mount) => ({
						...mount,
						createdAt: new Date(),
						id: crypto.randomUUID(),
						serviceId,
					})),
				);
			}
		});
	}

	/** The mount as a revision records it: volume, path and mode. */
	snapshot(): VolumeMountSnapshot {
		return {
			containerPath: this.row.containerPath,
			readOnly: this.row.readOnly,
			volumeId: this.row.volumeId,
		};
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
