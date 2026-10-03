import { migrationActions } from "#lib/server/migrate-actions.js";
import { DokployService } from "#lib/services/dokploy.service.js";

export const actions = migrationActions(DokployService);
