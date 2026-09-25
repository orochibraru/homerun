<script lang="ts">
	import { Activity, LayoutGrid, Plus, Server, Settings } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";
	import { Button } from "$lib/components/ui/button/index.js";

	const { data, children } = $props();
	const stack = $derived(data.stack);

	const tabs = $derived<(NavTab & { href: string })[]>([
		{
			href: resolve("/(protected)/stacks/[stackId]", { stackId: stack.id }),
			icon: Server,
			id: "services",
			label: `Services (${data.services.length})`,
		},
		{
			href: resolve("/(protected)/stacks/[stackId]/monitoring", {
				stackId: stack.id,
			}),
			icon: Activity,
			id: "monitoring",
			label: "Monitoring",
		},
		{
			href: resolve("/(protected)/stacks/[stackId]/settings", {
				stackId: stack.id,
			}),
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
  <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">{stack.name}</h1>
      <p class="text-text-muted mt-0.5 text-xs">
        {stack.description ?? `Services on the ${stack.slug} network.`}
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button
        href="{resolve('/templates')}?stackId={stack.id}"
        size="sm"
        variant="outline"
      >
        <LayoutGrid class="size-3.5" />
        From Template
      </Button>
      <Button href="{resolve('/services/new')}?stackId={stack.id}" size="sm">
        <Plus class="size-4" />
        Add Service
      </Button>
    </div>
  </div>

  <TabNav active={activeTabId} {tabs} />

  {@render children()}
</div>
