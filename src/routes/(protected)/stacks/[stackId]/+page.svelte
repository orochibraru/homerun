<script lang="ts">
	import { LayoutGrid, Plus, Server } from "@lucide/svelte";
	import { onMount, type Snippet } from "svelte";
	import { resolve } from "$app/paths";
	import EntityList from "$lib/components/entity-list.svelte";
	import ServiceContextMenu from "$lib/components/service-context-menu.svelte";
	import ServiceMenuHost from "$lib/components/service-menu-host.svelte";
	import ServiceTree, {
		type GraphServiceInfo,
	} from "$lib/components/service-tree.svelte";
	import StackDiagram from "$lib/components/stack-diagram.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { dependencyForest } from "$lib/service-graph";
	import { flattenStackTree } from "$lib/stack-tree";
	import { title } from "$lib/store/title";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();
	const stack = $derived(data.stack);

	onMount(() => title.set(stack.name));

	const view = new ViewMode("stack-services");
	let menuHost = $state<ReturnType<typeof ServiceMenuHost>>();
	let search = $state("");

	const services = $derived(
		new Map(data.graph.services.map((svc) => [svc.id, svc])),
	);
	const depMap = $derived(new Map(Object.entries(data.graph.deps)));
	const localStackIds = $derived(new Set(data.graph.stacks.map((s) => s.id)));
	const stackNames = $derived(new Map(data.stacks.map((s) => [s.id, s.name])));
	const sections = $derived(
		flattenStackTree(data.graph.stacks).filter(
			({ stack: s }) =>
				s.id === stack.id || data.graph.stacks.some((o) => o.id === s.parentId),
		),
	);
	const members = $derived(
		data.graph.services.filter(
			(svc) => svc.stackId && localStackIds.has(svc.stackId),
		),
	);
	const matches = $derived(
		members.filter((svc) =>
			`${svc.name} ${svc.slug} ${svc.image}`
				.toLowerCase()
				.includes(search.trim().toLowerCase()),
		),
	);

	function forestFor(stackId: string) {
		return dependencyForest(
			members.filter((svc) => svc.stackId === stackId).map((svc) => svc.id),
			depMap,
		);
	}
</script>

{#if members.length === 0 && data.graph.stacks.length === 1}
  <div class="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
    <Server class="text-text-subtle mb-3 size-8" />
    <p class="text-text-muted text-sm font-medium">
      No services in this stack yet
    </p>
    <div class="mt-5 flex gap-2">
      <Button href="{resolve('/templates')}?stackId={stack.id}" variant="outline">
        <LayoutGrid class="size-4" />
        From Template
      </Button>
      <Button href="{resolve('/services/new')}?stackId={stack.id}">
        <Plus class="size-4" />
        Add Service
      </Button>
    </div>
  </div>
{:else}
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <Input
      class="max-w-xs"
      placeholder="Search services…"
      type="search"
      bind:value={search}
    />
    <p class="text-text-subtle text-xs">
      {view.current === "card"
        ? "Arrows point from a service to what it connects to."
        : "Each service lists what it connects to underneath."}
      Connections are read from env vars pointing at another service's slug.
    </p>
    <div class="ml-auto">
      <ViewModeToggle {view} />
    </div>
  </div>

  {#if search.trim()}
    {#if matches.length === 0}
      <div class="border-border/70 rounded-xl border border-dashed py-12 text-center">
        <p class="text-text-muted text-sm">No services match your search.</p>
      </div>
    {:else}
      <EntityList
        items={matches.map((svc) => ({
          description: svc.image,
          href: `${resolve("/services")}/${svc.id}`,
          id: svc.id,
          subtitle: svc.slug,
          title: svc.name,
        }))}
        {view}
      />
    {/if}
  {:else if view.current === "card"}
    <StackDiagram
      deps={data.graph.deps}
      rootStackId={stack.id}
      services={data.graph.services}
      {stackNames}
      stacks={data.graph.stacks}
      {wrapper}
    />
  {:else}
    <div class="space-y-6">
      {#each sections as { depth, stack: section } (section.id)}
        {@const forest = forestFor(section.id)}
        <section style="margin-left: {depth * 1.5}rem">
          {#if section.id !== stack.id}
            <a
              class="eyebrow text-text-muted hover:text-text mb-2 inline-block"
              href={resolve("/(protected)/stacks/[stackId]", {
                stackId: section.id,
              })}
            >
              {section.name}
            </a>
          {/if}
          {#if forest.length > 0}
            <ServiceTree
              {localStackIds}
              nodes={forest}
              {services}
              {stackNames}
              {wrapper}
            />
          {:else}
            <p class="text-text-subtle text-xs">No services yet.</p>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
{/if}

{#snippet wrapper(svc: GraphServiceInfo, body: Snippet)}
  <ServiceContextMenu
    onaction={(op, id) => menuHost?.run(op, id)}
    ongroup={(s) => menuHost?.group(s)}
    onlink={(s) => menuHost?.link(s)}
    onungroup={(s) => menuHost?.ungroup(s)}
    service={svc}
  >
    {@render body()}
  </ServiceContextMenu>
{/snippet}

<ServiceMenuHost
  bind:this={menuHost}
  actionBase={resolve("/services")}
  services={data.allServices}
  stacks={data.stacks}
/>
