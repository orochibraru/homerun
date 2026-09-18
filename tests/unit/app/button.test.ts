import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";

const label = createRawSnippet(() => ({ render: () => "<span>Save</span>" }));

async function button() {
	return (await import("../../../src/lib/components/ui/button/button.svelte"))
		.default;
}

async function spinner() {
	return (await import("../../../src/lib/components/ui/spinner/spinner.svelte"))
		.default;
}

describe("Button", () => {
	test("renders a typed button with its children and variant classes", async () => {
		const { getByRole, unmount } = render(await button(), {
			children: label,
			class: "extra",
			size: "sm",
			variant: "destructive",
		});
		const el = getByRole("button");
		expect(el.getAttribute("type")).toBe("button");
		expect(el.getAttribute("data-slot")).toBe("button");
		expect(el.textContent).toBe("Save");
		expect(el.className).toContain("text-destructive");
		expect(el.className).toContain("h-8");
		expect(el.className).toContain("extra");
		unmount();
	});

	test("passes type and disabled through", async () => {
		const { getByRole, unmount } = render(await button(), {
			children: label,
			disabled: true,
			type: "submit",
		});
		const el = getByRole("button");
		expect(el.getAttribute("type")).toBe("submit");
		expect(el.hasAttribute("disabled")).toBe(true);
		unmount();
	});

	test("swaps its children for a spinner while loading", async () => {
		const { container, getByRole, unmount } = render(await button(), {
			children: label,
			loading: true,
		});
		expect(getByRole("button").textContent).not.toContain("Save");
		expect(container.querySelector("svg[aria-label='Loading']")).not.toBeNull();
		unmount();
	});

	test("with an href it renders a link", async () => {
		const { container, unmount } = render(await button(), {
			children: label,
			href: "/services",
		});
		const link = container.querySelector("a");
		expect(link?.getAttribute("href")).toBe("/services");
		expect(link?.hasAttribute("role")).toBe(false);
		expect(link?.hasAttribute("tabindex")).toBe(false);
		expect(link?.textContent).toBe("Save");
		unmount();
	});

	test("a disabled link drops its href and leaves the tab order", async () => {
		const { container, unmount } = render(await button(), {
			children: label,
			disabled: true,
			href: "/services",
		});
		const link = container.querySelector("a");
		expect(link?.hasAttribute("href")).toBe(false);
		expect(link?.getAttribute("role")).toBe("link");
		expect(link?.getAttribute("tabindex")).toBe("-1");
		expect(link?.getAttribute("aria-disabled")).toBe("true");
		unmount();
	});

	test("a loading link shows the spinner", async () => {
		const { container, unmount } = render(await button(), {
			children: label,
			href: "/services",
			loading: true,
		});
		expect(container.querySelector("a svg")).not.toBeNull();
		expect(container.querySelector("a")?.textContent).not.toContain("Save");
		unmount();
	});
});

describe("Spinner", () => {
	test("is an accessible spinning status icon by default", async () => {
		const { container, unmount } = render(await spinner(), {});
		const svg = container.querySelector("svg");
		expect(svg?.getAttribute("role")).toBe("status");
		expect(svg?.getAttribute("aria-label")).toBe("Loading");
		expect(svg?.getAttribute("class")).toContain("animate-spin");
		unmount();
	});

	test("takes a custom label, role, class and colour", async () => {
		const { container, unmount } = render(await spinner(), {
			"aria-label": "Deploying",
			class: "size-8",
			color: "red",
			role: "img",
		});
		const svg = container.querySelector("svg");
		expect(svg?.getAttribute("aria-label")).toBe("Deploying");
		expect(svg?.getAttribute("role")).toBe("img");
		expect(svg?.getAttribute("class")).toContain("size-8");
		expect(svg?.getAttribute("stroke")).toBe("red");
		unmount();
	});
});
