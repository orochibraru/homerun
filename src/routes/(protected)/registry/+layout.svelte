<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { Boxes, KeyRound, Settings2, Ticket } from "@lucide/svelte";
	import { onMount } from "svelte";

	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { formatBytes } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";

	const { children, data } = $props();

	onMount(() => {
		title.set("Docker Registry");
	});

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
	}

	const tabs = $derived<RouteTab[]>([
		{
			exact: true,
			href: resolve("/(protected)/registry"),
			icon: Boxes,
			description: "Mirrored and pushed images, with their tags",
			id: "images",
			label: "Images",
			summary: data.status.running
				? data.status.sizeBytes === null
					? "Running"
					: `${formatBytes(data.status.sizeBytes)} stored`
				: "Not running",
		},
		{
			exact: false,
			href: resolve("/(protected)/registry/tokens"),
			icon: Ticket,
			description: "Usernames and secrets to push and pull with",
			id: "tokens",
			label: "Tokens",
			summary: `${data.status.tokenCount} ${data.status.tokenCount === 1 ? "token" : "tokens"}${data.status.authEnabled ? "" : ", auth off"}`,
		},
		{
			exact: false,
			href: resolve("/(protected)/registry/credentials"),
			icon: KeyRound,
			description: "Logins for other registries: build cache and private pulls",
			id: "credentials",
			label: "Credentials",
		},
		{
			exact: false,
			href: resolve("/(protected)/registry/settings"),
			icon: Settings2,
			description: "Authentication and publishing it on a domain",
			id: "settings",
			label: "Settings",
			summary: data.status.publicHost ?? "Not published",
		},
	]);

	function isActive(href: string, exact: boolean): boolean {
		if (href === resolve("/(protected)/registry")) {
			return (
				page.url.pathname === href ||
				page.url.pathname.startsWith(`${href}/images/`)
			);
		}
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}

	const activeTabId = $derived(
		tabs.find((tab) => isActive(tab.href, tab.exact))?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
	<header class="mb-6">
		<h1 class="text-text text-2xl font-semibold max-md:hidden">
			Docker Registry
		</h1>
		<p class="text-text-muted mt-1 text-sm">
			The built-in image registry. Homerun mirrors every image it scans through
			it, and it can double as a private registry you push to.
		</p>
	</header>

	<TabNav active={activeTabId} {tabs}>
		{@render children()}
	</TabNav>
</div>
