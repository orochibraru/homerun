import { requireUser } from "#lib/server/remote-auth.js";
import {
	type DashboardIcon,
	DashboardIconsService,
} from "#lib/services/dashboard-icons.service.js";
import { query } from "$app/server";

export const getDashboardIcons = query(async (): Promise<DashboardIcon[]> => {
	requireUser();
	return await DashboardIconsService.catalog();
});
