import { migrationActions } from "$lib/server/migrate-actions";
import { DokployService } from "$lib/services/dokploy.service";

export const actions = migrationActions(DokployService);
