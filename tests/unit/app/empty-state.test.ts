import { describe, expect, test } from "bun:test";
import { Box } from "@lucide/svelte";
import { render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import EmptyState from "../../../src/lib/components/empty-state.svelte";

describe("EmptyState", () => {
	test("renders the title and, when given one, the subtitle", () => {
		const { container, getByText } = render(EmptyState, {
			icon: Box,
			subtitle: "Deploy your first one to see it here.",
			title: "No services yet",
		});

		expect(getByText("No services yet")).not.toBeNull();
		expect(getByText("Deploy your first one to see it here.")).not.toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
	});

	test("omits the subtitle paragraph entirely when none is given", () => {
		const { container } = render(EmptyState, {
			icon: Box,
			title: "Nothing here",
		});

		const paragraphs = container.querySelectorAll("p");
		expect(paragraphs).toHaveLength(1);
		expect(paragraphs[0]?.textContent?.trim()).toBe("Nothing here");
	});

	test("renders the children snippet (e.g. a call-to-action) when provided", () => {
		const cta = createRawSnippet(() => ({
			render: () => "<button>Create service</button>",
		}));

		const { getByText } = render(EmptyState, {
			children: cta,
			icon: Box,
			title: "No services yet",
		});

		expect(getByText("Create service")).not.toBeNull();
	});
});
