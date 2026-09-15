import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import AsyncBlock from "../../../src/lib/components/async-block.svelte";

const pending = createRawSnippet(() => ({
	render: () => "<p>loading…</p>",
}));

const children = createRawSnippet((value: () => string) => ({
	render: () => `<p>${value()}</p>`,
}));

function fakeQuery(state: { current?: string; error?: unknown }) {
	return {
		current: state.current,
		error: state.error,
		loading: !(state.current || state.error),
		ready: state.current !== undefined,
		refresh: async () => {},
		set: () => {},
		withOverride: () => ({}),
	} as never;
}

describe("AsyncBlock", () => {
	test("renders the pending snippet until the query is ready", () => {
		const { getByText, queryByText } = render(AsyncBlock, {
			children,
			pending,
			query: fakeQuery({}),
		});

		expect(getByText("loading…")).not.toBeNull();
		expect(queryByText("Retry")).toBeNull();
	});

	test("renders the children snippet with the resolved value", () => {
		const { getByText, queryByText } = render(AsyncBlock, {
			children,
			pending,
			query: fakeQuery({ current: "the goods" }),
		});

		expect(getByText("the goods")).not.toBeNull();
		expect(queryByText("loading…")).toBeNull();
	});

	test("an error wins over both, and offers a retry", () => {
		const { getByText, queryByText } = render(AsyncBlock, {
			children,
			errorTitle: "Couldn't load the thing.",
			pending,
			query: fakeQuery({ error: new Error("daemon unreachable") }),
		});

		expect(getByText("Couldn't load the thing.")).not.toBeNull();
		expect(getByText("daemon unreachable")).not.toBeNull();
		expect(getByText("Retry")).not.toBeNull();
		expect(queryByText("loading…")).toBeNull();
	});

	test("falls back to a sentence when the error carries no message", () => {
		const { getByText } = render(AsyncBlock, {
			children,
			pending,
			query: fakeQuery({ error: { status: 500 } }),
		});

		expect(getByText("The server didn't say why.")).not.toBeNull();
	});
});
