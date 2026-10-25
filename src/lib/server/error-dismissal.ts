import { DeploymentDTO } from "#lib/dto/deployment-dto.js";

export interface DismissedBy {
	createdAt: Date;
	gitCommit: string | null;
	id: string;
	imageRef: string | null;
}

export interface ErrorDismissal {
	dismissedBy: DismissedBy | null;
	dismissedCount: number;
	showDismissed: boolean;
}

/**
 * Where an error tab's list starts: the service's last dismissal, or nothing
 * when the URL asks to show dismissed errors too (`?dismissed=1`).
 */
export function errorsSince(
	svc: { errorsDismissedAt: Date | null },
	url: URL,
): { showDismissed: boolean; since: Date | null } {
	const showDismissed = url.searchParams.get("dismissed") === "1";
	return {
		showDismissed,
		since: showDismissed ? null : svc.errorsDismissedAt,
	};
}

/**
 * The "N earlier errors are hidden" banner's data for one error tab:
 * `countUpTo` counts that tab's own errors up to the dismissal, and the
 * revision that dismissed them, if a deploy did, is looked up for its label.
 */
export async function errorDismissal(
	svc: {
		errorsDismissedAt: Date | null;
		errorsDismissedByDeploymentId: string | null;
	},
	showDismissed: boolean,
	since: Date | null,
	countUpTo: (since: Date) => Promise<number>,
): Promise<ErrorDismissal> {
	const [dismissedCount, deployment] = await Promise.all([
		since ? countUpTo(since) : 0,
		svc.errorsDismissedByDeploymentId
			? DeploymentDTO.get(svc.errorsDismissedByDeploymentId)
			: null,
	]);
	const row = deployment?.toJSON();
	return {
		dismissedBy: row
			? {
					createdAt: row.createdAt,
					gitCommit: row.gitCommit,
					id: row.id,
					imageRef: row.imageRef,
				}
			: null,
		dismissedCount,
		showDismissed,
	};
}
