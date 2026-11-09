<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		Activity,
		BarChart3,
		Settings2,
		ShieldBan,
		ShieldCheck,
	} from "@lucide/svelte";

	import TabNav from "#lib/components/tab-nav.svelte";
	import { can } from "#lib/permissions.js";
	import { currentHref, visibleItems } from "#lib/ui-mode.js";

	const { children, data } = $props();

	const tabs = $derived([
		{
			description: "Traffic, uptime and host resources across every service",
			href: resolve("/(protected)/monitoring"),
			icon: BarChart3,
			id: "monitoring",
			label: "Overview",
		},
		{
			description: "Timings of Homerun's own jobs: deploys, builds, backups",
			href: resolve("/(protected)/monitoring/traces"),
			icon: Activity,
			id: "monitoring/traces",
			label: "Traces",
		},
		...(can(data.permissions, "settings", "read")
			? [
					{
						description: "Addresses banned for probing blocked paths",
						href: resolve("/(protected)/monitoring/blocked"),
						icon: ShieldBan,
						id: "monitoring/blocked",
						label: "Blocked IPs",
					},
					{
						description: "CrowdSec's decisions, alerts and blocklists",
						href: resolve("/(protected)/monitoring/crowdsec"),
						icon: ShieldCheck,
						id: "monitoring/crowdsec",
						label: "CrowdSec",
					},
					{
						description: "The OpenTelemetry collector and log retention",
						href: resolve("/(protected)/monitoring/settings"),
						icon: Settings2,
						id: "monitoring/settings",
						label: "Settings",
					},
				]
			: []),
	]);

	const shown = $derived(visibleItems(data.uiMode, tabs, page.url.pathname));

	const active = $derived(
		tabs.find(
			(tab) =>
				tab.href ===
				currentHref(
					page.url.pathname,
					tabs.map((candidate) => candidate.href),
				),
		)?.id ?? "monitoring",
	);
</script>

<div class="p-5 md:p-6">
	<div class="mb-6">
		<h1 class="text-text text-lg font-semibold tracking-tight max-md:hidden">
			Monitoring
		</h1>
		<p class="text-text-muted mt-1 text-sm">
			Traffic and uptime across every service, this host's CPU and memory, and
			the traces of Homerun's own jobs.
		</p>
	</div>

	{#if shown.length > 1}
		<TabNav {active} tabs={shown}>
			{@render children()}
		</TabNav>
	{:else}
		{@render children()}
	{/if}
</div>
