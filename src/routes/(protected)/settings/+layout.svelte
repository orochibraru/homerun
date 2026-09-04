<script lang="ts">
	import { Container, Globe, KeyRound, Mail, Network } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";
	import { title } from "$lib/store/title";

	const { data, children } = $props();

	const highlighted = $derived(
		new Set(
			(page.url.searchParams.get("highlight") ?? "").split(",").filter(Boolean),
		),
	);

	onMount(() => {
		title.set("Settings");
		const [first] = highlighted;
		if (first) {
			document
				.getElementById(first)
				?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	});

	const FIELD_TAB: Record<string, string> = {
		authCheckUrl: "general",
		authCrossSubdomainCookies: "general",
		baseDomain: "general",
		dockerNetworkName: "docker",
		dockerSocketPath: "docker",
		smtpFrom: "email",
		smtpHost: "email",
		smtpPassword: "email",
		smtpPort: "email",
		smtpUser: "email",
	};

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
	}

	const tabs = $derived<RouteTab[]>(
		[
			{
				exact: true,
				href: resolve("/settings"),
				icon: Globe,
				id: "general",
				label: "General",
			},
			{
				exact: false,
				href: resolve("/settings/docker"),
				icon: Container,
				id: "docker",
				label: "Docker",
			},
			{
				exact: false,
				href: resolve("/settings/networking"),
				icon: Network,
				id: "networking",
				label: "Networking",
			},
			{
				exact: false,
				href: resolve("/settings/email"),
				icon: Mail,
				id: "email",
				label: "Email",
			},
			{
				exact: false,
				href: resolve("/settings/authentication"),
				icon: KeyRound,
				id: "authentication",
				label: "Authentication",
			},
		].map((tab) => ({
			...tab,
			hasWarning: Object.keys(data.fieldIssues).some(
				(field) => FIELD_TAB[field] === tab.id,
			),
		})),
	);

	function isActive(href: string, exact: boolean): boolean {
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}

	const activeTabId = $derived(
		tabs.find((tab) => isActive(tab.href, tab.exact))?.id ?? "",
	);
</script>

<div class="p-6 md:p-8">
  <div class="mb-8">
    <h1 class="text-text text-2xl font-bold">Settings</h1>
    <p class="text-text-muted mt-1 text-sm">
      Instance-wide configuration : stored in the database and applied live, no
      restart needed. Leave a field blank to fall back to its env-var default
      (shown as the placeholder); env vars still work for anyone bootstrapping
      via docker-compose before ever visiting this page.
    </p>
  </div>

  <TabNav active={activeTabId} {tabs} />

  {@render children()}
</div>
