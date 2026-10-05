export interface StatusPagePick {
	includeChildren: boolean;
	serviceId: string;
}

export interface StatusPageMember {
	childOf: string | null;
	id: string;
	name: string;
}

export interface MemberCandidate {
	channelCanary: boolean;
	id: string;
	name: string;
	previewParentId: string | null;
	previewPrNumber: number | null;
}

/**
 * The services a hand-picked status page shows, in `services` order: each
 * picked service, followed by its pull request previews and release-channel
 * canary when its pick includes them (canary first, then previews by PR
 * number). Its environments aren't children here: they're picked on their
 * own. A child that was also picked on its own keeps its own row instead.
 */
export function resolveStatusPageMembers(
	picks: StatusPagePick[],
	services: MemberCandidate[],
): StatusPageMember[] {
	const byId = new Map(picks.map((pick) => [pick.serviceId, pick]));
	const members: StatusPageMember[] = [];
	for (const svc of services) {
		const pick = byId.get(svc.id);
		if (!pick) {
			continue;
		}
		members.push({ childOf: null, id: svc.id, name: svc.name });
		if (!pick.includeChildren) {
			continue;
		}
		const children = services
			.filter(
				(child) =>
					child.previewParentId === svc.id &&
					(child.previewPrNumber !== null || child.channelCanary) &&
					!byId.has(child.id),
			)
			.toSorted(
				(a, b) =>
					(a.previewPrNumber ?? -1) - (b.previewPrNumber ?? -1) ||
					a.id.localeCompare(b.id),
			);
		for (const child of children) {
			members.push({ childOf: svc.id, id: child.id, name: child.name });
		}
	}
	return members;
}

/**
 * Reads a status page form's picks: one `serviceIds` entry per picked service
 * (duplicates dropped) and one `includeChildren` entry per pick that brings
 * its previews and canary along.
 */
export function picksFromForm(form: FormData): StatusPagePick[] {
	const include = new Set(form.getAll("includeChildren").map(String));
	return [...new Set(form.getAll("serviceIds").map(String))]
		.filter((id) => id !== "")
		.map((serviceId) => ({
			includeChildren: include.has(serviceId),
			serviceId,
		}));
}

export interface StatusPageServiceOption {
	hasChildren: boolean;
	id: string;
	name: string;
	pickable: boolean;
	previewParentId: string | null;
	stackId: string | null;
}

/**
 * The services a status page form can pick from: every service and
 * environment (`pickable`), not previews and canaries, which come along with
 * their parent. `hasChildren` is set on a service that has, or can spawn,
 * pull request previews or a canary, which is when its pick offers to
 * include them.
 */
export function statusPageServiceOptions(
	rows: Array<{
		channelCanary: boolean;
		channelsEnabled: boolean;
		id: string;
		name: string;
		previewParentId: string | null;
		previewPrNumber: number | null;
		previewsEnabled: boolean;
		stackId: string | null;
	}>,
): StatusPageServiceOption[] {
	const isChild = (row: (typeof rows)[number]) =>
		row.previewParentId !== null &&
		(row.previewPrNumber !== null || row.channelCanary);
	const parents = new Set(
		rows.filter(isChild).map((row) => row.previewParentId),
	);
	return rows.map((row) => ({
		hasChildren:
			row.previewsEnabled || row.channelsEnabled || parents.has(row.id),
		id: row.id,
		name: row.name,
		pickable: !isChild(row),
		previewParentId: row.previewParentId,
		stackId: row.stackId,
	}));
}
