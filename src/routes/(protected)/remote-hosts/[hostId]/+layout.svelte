<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		ChevronLeft,
		FileText,
		History,
		LayoutGrid,
		Server,
		Settings,
	} from "@lucide/svelte";

	import TabNav from "#lib/components/tab-nav.svelte";

	const { data, children } = $props();
	const host = $derived(data.host);

	const tabs = $derived([
		{
			href: resolve("/(protected)/remote-hosts/[hostId]", { hostId: host.id }),
			description: "Status, availability and version",
			icon: LayoutGrid,
			id: "overview",
			label: "Overview",
			hasWarning: data.agentStatus?.reachable === false,
			summary: data.agentStatus
				? data.agentStatus.reachable
					? `Reachable${data.agentStatus.version ? ` · ${data.agentStatus.version}` : ""}`
					: "Unreachable"
				: host.enabled
					? "Enabled"
					: "Disabled",
		},
		...(host.kind === "agent"
			? [
					{
						href: resolve("/(protected)/remote-hosts/[hostId]/logs", {
							hostId: host.id,
						}),
						description: "What the agent logged lately",
						icon: FileText,
						id: "logs",
						label: "Logs",
					},
					{
						href: resolve("/(protected)/remote-hosts/[hostId]/events", {
							hostId: host.id,
						}),
						description: "The host's Docker events over the last day",
						icon: History,
						id: "events",
						label: "Events",
					},
				]
			: []),
		{
			href: resolve("/(protected)/remote-hosts/[hostId]/settings", {
				hostId: host.id,
			}),
			description: "Connection, builds and danger zone",
			icon: Settings,
			id: "settings",
			label: "Settings",
		},
	]);

	const activeTabId = $derived(
		tabs.findLast((tab) => page.url.pathname.startsWith(tab.href))?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
	<a
		class="text-text-muted hover:text-text mb-4 inline-flex items-center gap-1 text-sm"
		href={resolve("remote-hosts")}><ChevronLeft class="size-4" />Remote Hosts</a
	>

	<div class="mb-6 flex items-center gap-3">
		<div
			class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md"
		>
			<Server class="size-5" />
		</div>
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<h1 class="text-text truncate text-lg font-semibold tracking-tight">
					{host.name}
				</h1>
				{#if !host.enabled}
					<span
						class="bg-surface-2 text-text-muted shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
					>
						Disabled
					</span>
				{/if}
			</div>
			<p class="text-text-muted text-sm">
				{host.kind === "agent" ? "Homerun Agent" : "Direct Docker connection"}
			</p>
		</div>
	</div>

	<TabNav active={activeTabId} {tabs}>
		{@render children()}
	</TabNav>
</div>
