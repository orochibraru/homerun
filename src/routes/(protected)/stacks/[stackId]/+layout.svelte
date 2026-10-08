<script lang="ts">
	import {
		Activity,
		FolderKanban,
		FolderPlus,
		LayoutGrid,
		Plus,
		Server,
		Settings,
	} from "@lucide/svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { data, children } = $props();
	const stack = $derived(data.stack);

	const tabs = $derived<(NavTab & { href: string })[]>([
		{
			href: resolve("/(protected)/stacks/[stackId]", { stackId: stack.id }),
			icon: Server,
			id: "services",
			label: `Services (${data.services.filter((svc) => !svc.previewParentId).length})`,
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
		<div class="flex items-center gap-3">
      <TemplateIcon class="size-10 rounded-lg" fallback={FolderKanban} icon={stack.icon} />
			<div>
        <h1 class="text-text text-lg font-semibold tracking-tight">{stack.name}</h1>
        <p class="text-text-muted mt-0.5 text-xs">
          {stack.description ?? `Services on the ${stack.slug} network.`}
        </p>
			</div>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button
				href="{resolve('stacks/new')}?parentId={stack.id}"
				size="sm"
				variant="outline"
      >
        <FolderPlus class="size-3.5" />
        New Substack
      </Button>
			<Button
				href="{resolve('templates')}?stackId={stack.id}"
				size="sm"
				variant="outline"
			><LayoutGrid class="size-3.5" />From Template</Button>

			<Button
				href="{resolve('services/new')}?stackId={stack.id}"
				size="sm"
			><Plus class="size-4" />Add Service</Button>
		</div>
	</div>

	<TabNav active={activeTabId} tabs={tabs}>
	  {@render children()}
	</TabNav>
</div>
