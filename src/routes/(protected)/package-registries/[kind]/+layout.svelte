<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { Package, Settings2, Ticket } from "@lucide/svelte";

	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { PACKAGE_REGISTRY_INFO } from "#lib/package-registries.js";
	import { title } from "#lib/store/title.js";

	const { children, data } = $props();

	const info = $derived(PACKAGE_REGISTRY_INFO[data.kind]);

	$effect(() => {
		title.set(info.title);
	});

	const overviewHref = $derived(
		resolve("/(protected)/package-registries/[kind]", { kind: data.kind }),
	);

	const tabs: NavTab[] = $derived([
		{
			description: "Whether it runs, its address and how to use it",
			href: overviewHref,
			icon: Package,
			id: "overview",
			label: "Overview",
		},
		{
			description: "Credentials to publish and install packages with",
			href: resolve("/(protected)/package-registries/[kind]/tokens", {
				kind: data.kind,
			}),
			icon: Ticket,
			id: "tokens",
			label: "Tokens",
		},
		{
			description: "Its public hostname, and turning it off",
			href: resolve("/(protected)/package-registries/[kind]/settings", {
				kind: data.kind,
			}),
			icon: Settings2,
			id: "settings",
			label: "Settings",
		},
	]);

	const activeTabId = $derived(
		tabs.find((tab) =>
			tab.href === overviewHref
				? page.url.pathname === overviewHref
				: page.url.pathname.startsWith(tab.href ?? ""),
		)?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
	<header class="mb-6">
		<h1 class="text-text text-2xl font-semibold max-md:hidden">
			{info.title}
		</h1>
		<p class="text-text-muted mt-1 text-sm">{info.description}</p>
	</header>

	<TabNav active={activeTabId} {tabs}>
		{@render children()}
	</TabNav>
</div>
