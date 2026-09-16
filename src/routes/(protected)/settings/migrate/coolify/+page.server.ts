import { migrationActions } from "$lib/server/migrate-actions";
import { CoolifyService } from "$lib/services/coolify.service";

export const actions = migrationActions(CoolifyService);
