<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { FolderOpen, HardDrive } from "@lucide/svelte";

	import TabNav from "#lib/components/tab-nav.svelte";
	import { timeAgo } from "#lib/formatting.js";

	const { data, children } = $props();
	const vol = $derived(data.volume);

	const tabs = $derived([
		{
			href: resolve("/(protected)/storage/[volumeId]", { volumeId: vol.id }),
			description: "Scheduled backups and where they go",
			icon: HardDrive,
			id: "overview",
			label: "Overview",
			summary: vol.backupEnabled
				? vol.backupLastRunAt
					? `Backed up ${timeAgo(vol.backupLastRunAt)}`
					: "Backups on, none yet"
				: "Backups off",
		},
		{
			href: resolve("/(protected)/storage/[volumeId]/files", {
				volumeId: vol.id,
			}),
			description: "Browse, download and upload what's inside",
			icon: FolderOpen,
			id: "files",
			label: "Files",
		},
	]);

	const activeTabId = $derived(
		tabs.findLast((tab) => page.url.pathname.startsWith(tab.href))?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
	<div class="mb-6">
		<h1 class="text-text text-lg font-semibold tracking-tight">{vol.name}</h1>
		<p class="text-text-muted mt-1 text-sm">
			{vol.kind} · {vol.source}{vol.disk ? ` · on ${vol.disk}` : ""}
		</p>
	</div>

	<TabNav active={activeTabId} {tabs}>
		{@render children()}
	</TabNav>
</div>
