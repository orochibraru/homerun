import { eq } from "drizzle-orm";
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

/** Wraps the `service_volume` join table — a mount of one StorageVolume into one service. */
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

  async detach(): Promise<void> {
    await db.delete(serviceVolume).where(eq(serviceVolume.id, this.row.id));
  }

  get id(): string {
    return this.row.id;
  }
  get serviceId(): string {
    return this.row.serviceId;
  }
}
