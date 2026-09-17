export class WorkloadDetachError extends Error {}

/**
 * Why removing a container or swarm service failed, or null when it didn't
 * really fail : Docker answering 404 means the workload is already gone, which
 * is exactly what a delete wants.
 */
export function removalFailure(error: unknown): string | null {
	if ((error as { statusCode?: number } | null)?.statusCode === 404) {
		return null;
	}
	return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a workload removal and reports what went wrong instead of throwing.
 *
 * @returns Null when the workload is gone (removed now or already missing),
 * else the failure reason.
 */
export async function tryRemoveWorkload(
	remove: () => Promise<void>,
): Promise<string | null> {
	try {
		await remove();
		return null;
	} catch (error) {
		return removalFailure(error);
	}
}
