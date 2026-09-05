import { describe, expect, mock, test } from "bun:test";

const promise = mock(
	(_p: unknown, _opts: Record<string, unknown>) => undefined,
);
mock.module("svelte-sonner", () => ({ toast: { promise } }));

const { enhanceToast, saveToast, toastError } = await import(
	"../../../src/lib/toast"
);

type Settle = (result: unknown) => Promise<void>;

/**
 * Drives one `enhanceToast` submission and hands back the promise that
 * `toast.promise` was given, plus the options it was called with, so a test
 * can assert on how a real ActionResult resolves or rejects it.
 */
function run(options: Parameters<typeof enhanceToast>[0]) {
	promise.mockClear();
	const submit = enhanceToast(options);
	const formData = new FormData();
	const callback = submit({ formData } as never) as unknown as (arg: {
		result: unknown;
		update: () => Promise<void>;
	}) => Promise<void>;
	const [tracked, opts] = promise.mock.calls[0] as [
		Promise<unknown>,
		Record<string, unknown>,
	];
	const update = mock(() => Promise.resolve());
	const settle: Settle = (result) => callback({ result, update });
	return { formData, opts, settle, tracked, update };
}

describe("toastError", () => {
	test("prefers a real Error's message", () => {
		expect(toastError(new Error("boom"), "fallback")).toBe("boom");
	});

	test("falls back for a non-Error, and for an Error with no message", () => {
		expect(toastError("boom", "fallback")).toBe("fallback");
		expect(toastError(new Error(""), "fallback")).toBe("fallback");
	});
});

describe("enhanceToast", () => {
	test("resolves with the action's data on success", async () => {
		const { settle, tracked, update } = run({
			loading: "Saving",
			success: "Saved.",
		});
		await settle({ type: "success", data: { id: "abc" } });
		expect(await tracked).toEqual({ id: "abc" });
		expect(update).toHaveBeenCalled();
	});

	test("rejects with the action's own error message on failure", async () => {
		const { settle, tracked } = run({
			error: "fallback",
			loading: "Saving",
			success: "Saved.",
		});
		await settle({ type: "failure", data: { error: "Slug already taken." } });
		expect(tracked).rejects.toThrow("Slug already taken.");
	});

	/**
	 * This repo's form actions report zod failures as `errors`, a
	 * field->messages map, not as a single `error` string : surfacing the
	 * first of those is what keeps a validation failure legible in the toast
	 * instead of collapsing to the generic fallback.
	 */
	test("surfaces the first field error from a validation failure", async () => {
		const { settle, tracked } = run({
			error: "fallback",
			loading: "Saving",
			success: "Saved.",
		});
		await settle({
			type: "failure",
			data: { errors: { slug: ["Slug is required."] } },
		});
		expect(tracked).rejects.toThrow("Slug is required.");
	});

	test("falls back when a failure carries no message", async () => {
		const { settle, tracked } = run({
			error: "Check the form for errors.",
			loading: "Saving",
			success: "Saved.",
		});
		await settle({ type: "failure", data: {} });
		expect(tracked).rejects.toThrow("Check the form for errors.");
	});

	test("treats a redirect as success", async () => {
		const { settle, tracked } = run({
			loading: "Deleting",
			success: "Deleted.",
		});
		await settle({ type: "redirect", location: "/services" });
		expect(await tracked).toBeUndefined();
	});

	test("runs the lifecycle hooks in order, with the action's data", async () => {
		const calls: string[] = [];
		let seen: unknown;
		const { settle } = run({
			loading: "Saving",
			onComplete: () => {
				calls.push("complete");
			},
			onSettled: () => {
				calls.push("settled");
			},
			onStart: () => {
				calls.push("start");
			},
			onSubmit: () => {
				calls.push("submit");
			},
			onSuccess: (data) => {
				calls.push("success");
				seen = data;
			},
			success: "Saved.",
		});
		await settle({ type: "success", data: { href: "/services/x" } });
		expect(calls).toEqual([
			"start",
			"submit",
			"settled",
			"success",
			"complete",
		]);
		expect(seen).toEqual({ href: "/services/x" });
	});

	/**
	 * The reason this helper exists rather than a bare `toast.error` in each
	 * enhance callback: a failure has to hand the caller back its pending
	 * state, or the form stays disabled with no way to retry.
	 */
	test("runs onFailure with the failure data and never onSuccess", async () => {
		const calls: string[] = [];
		let seen: unknown;
		const { settle, tracked } = run({
			error: "fallback",
			loading: "Saving",
			onFailure: (data) => {
				calls.push("failure");
				seen = data;
			},
			onSettled: () => {
				calls.push("settled");
			},
			onSuccess: () => {
				calls.push("success");
			},
			success: "Saved.",
		});
		await settle({ type: "failure", data: { error: "nope" } });
		expect(calls).toEqual(["settled", "failure"]);
		expect(seen).toEqual({ error: "nope" });
		expect(tracked).rejects.toThrow("nope");
	});

	test("passes the pre-submit FormData to onSubmit", async () => {
		const { formData, settle } = run({
			loading: "Deploying",
			onSubmit: ({ formData: fd }) => fd.set("deploymentId", "abc"),
			success: "Deployed.",
		});
		expect(formData.get("deploymentId")).toBe("abc");
		await settle({ type: "success", data: {} });
	});

	test("forwards the reset option through to update", async () => {
		const { settle, update } = run({
			loading: "Deploying",
			reset: false,
			success: "Deployed.",
		});
		await settle({ type: "success", data: {} });
		expect(update).toHaveBeenCalledWith({ reset: false });
	});

	test("leaves update's own defaults alone when reset is unset", async () => {
		const { settle, update } = run({ loading: "Saving", success: "Saved." });
		await settle({ type: "success", data: {} });
		expect(update).toHaveBeenCalledWith(undefined);
	});
});

describe("saveToast", () => {
	test("builds the section-save messages from one label", async () => {
		promise.mockClear();
		const submit = saveToast("Docker settings");
		submit({ formData: new FormData() } as never);
		const [, opts] = promise.mock.calls[0] as [
			Promise<unknown>,
			Record<string, unknown>,
		];
		expect(opts.loading).toBe("Saving docker settings");
		expect(opts.success).toBe("Docker settings saved.");
	});
});
