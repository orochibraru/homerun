import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { ExternalToast } from "svelte-sonner";
import { toast } from "svelte-sonner";

export type ActionData = Record<string, unknown> | undefined;

export interface ToastMessages {
	error?: string;
	loading: string;
	success: string | ((data: ActionData) => string);
}

export interface EnhanceToastOptions extends ToastMessages {
	action?: ExternalToast["action"];
	description?: string;
	onComplete?: () => void | Promise<void>;
	onFailure?: (data: ActionData) => void;
	onSettled?: () => void;
	onSubmit?: (input: Parameters<SubmitFunction>[0]) => void;
	onStart?: () => void;
	onSuccess?: (data: ActionData) => void | Promise<void>;
	reset?: boolean;
}

const DEFAULT_ERROR = "Something went wrong. Please try again.";

export function toastError(error: unknown, fallback = DEFAULT_ERROR): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return fallback;
}

function resultError(
	result: Extract<ActionResult, { type: "failure" | "error" }>,
	fallback: string,
): Error {
	if (result.type === "error") {
		return new Error(toastError(result.error, fallback));
	}
	const data = result.data as
		| { error?: string; errors?: Record<string, string[]> }
		| undefined;
	const firstFieldError = data?.errors
		? Object.values(data.errors).flat()[0]
		: undefined;
	return new Error(firstFieldError ?? data?.error ?? fallback);
}

export function enhanceToast(options: EnhanceToastOptions): SubmitFunction {
	const fallback = options.error ?? DEFAULT_ERROR;

	return (input) => {
		let settle!: (data: ActionData) => void;
		let fail!: (error: Error) => void;
		const submission = new Promise<ActionData>((resolve, reject) => {
			settle = resolve;
			fail = reject;
		});

		options.onStart?.();
		options.onSubmit?.(input);
		toast.promise(submission, {
			action: options.action,
			description: options.description,
			error: (error: unknown) => toastError(error, fallback),
			loading: options.loading,
			success: options.success,
		});

		return async ({ result, update }) => {
			options.onSettled?.();
			if (result.type === "failure" || result.type === "error") {
				options.onFailure?.(
					result.type === "failure" ? (result.data as ActionData) : undefined,
				);
				fail(resultError(result, fallback));
			} else {
				const data =
					result.type === "success" ? (result.data as ActionData) : undefined;
				await options.onSuccess?.(data);
				settle(data);
			}
			await update(
				options.reset === undefined ? undefined : { reset: options.reset },
			);
			await options.onComplete?.();
		};
	};
}

export function saveToast(sectionLabel: string): SubmitFunction {
	return enhanceToast({
		error: "Check the form for errors.",
		loading: `Saving ${sectionLabel.toLowerCase()}`,
		success: `${sectionLabel} saved.`,
	});
}
