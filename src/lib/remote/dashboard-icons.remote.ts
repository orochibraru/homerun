import { query } from "$app/server";
import { requireUser } from "$lib/server/remote-auth";
import {
	type DashboardIcon,
	DashboardIconsService,
} from "$lib/services/dashboard-icons.service";

export const getDashboardIcons = query(async (): Promise<DashboardIcon[]> => {
	requireUser();
	return await DashboardIconsService.catalog();
});
