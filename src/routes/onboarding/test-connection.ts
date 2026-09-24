import type { SubmitFunction } from "@sveltejs/kit";
import { toast } from "svelte-sonner";
import { toastError } from "$lib/toast";

/** Runs a DNS "Test connection" submission through its own promise toast, without `update()`, so nothing typed into the wizard is reset. */
export const testConnection: SubmitFunction = () => {
	let settle!: (message: string) => void;
	let reject!: (error: Error) => void;
	const outcome = new Promise<string>((resolvePromise, rejectPromise) => {
		settle = resolvePromise;
		reject = rejectPromise;
	});
	toast.promise(outcome, {
		error: (error: unknown) =>
			toastError(error, "Couldn't test the connection."),
		loading: "Testing the connection",
		success: (message: string) => message,
	});
	return ({ result }) => {
		if (result.type === "success") {
			settle(
				(result.data?.message as string | undefined) ?? "Connection works.",
			);
		} else if (result.type === "failure") {
			reject(
				new Error(
					(result.data?.error as string | undefined) ??
						"Couldn't test the connection.",
				),
			);
		} else {
			reject(new Error("Couldn't test the connection."));
		}
	};
};
