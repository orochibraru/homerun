import { migrationActions } from "#lib/server/migrate-actions.js";
import { CoolifyService } from "#lib/services/coolify.service.js";

export const actions = migrationActions(CoolifyService);
