<script lang="ts">
	import { FolderOpen, HardDrive } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import TabNav from "$lib/components/tab-nav.svelte";

	const { data, children } = $props();
	const vol = $derived(data.volume);

	const tabs = $derived([
		{
			href: resolve("/(protected)/storage/[volumeId]", { volumeId: vol.id }),
			icon: HardDrive,
			id: "overview",
			label: "Overview",
		},
		{
			href: resolve("/(protected)/storage/[volumeId]/files", {
				volumeId: vol.id,
			}),
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
    <p class="text-text-muted mt-1 text-sm">{vol.kind} · {vol.source}</p>
  </div>

  <TabNav active={activeTabId} {tabs} />

  {@render children()}
</div>
