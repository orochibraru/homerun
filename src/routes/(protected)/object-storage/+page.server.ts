import { ObjectStorageService } from "#lib/services/object-storage.service.js";

export const load = () => ({ listing: ObjectStorageService.buckets() });
