import { type EnhanceToastOptions, enhanceToast } from "#lib/toast.js";
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";

/**
 * `enhanceToast` for a form action that queues a background job and returns
 * its `jobId`: the toast carries a "View task" button that opens the job's
 * page under Scheduling, with its log.
 */
export function queuedJobToast(options: Omit<EnhanceToastOptions, "action">) {
	let jobId = "";
	return enhanceToast({
		...options,
		action: {
			label: "View task",
			onClick: () =>
				void goto(
					jobId
						? resolve("/(protected)/scheduling/jobs/[jobId]", { jobId })
						: resolve("scheduling"),
				),
		},
		onSuccess: async (data) => {
			jobId = typeof data?.jobId === "string" ? data.jobId : "";
			await options.onSuccess?.(data);
		},
	});
}
