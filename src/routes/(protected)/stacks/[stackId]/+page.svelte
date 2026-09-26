<script lang="ts">
	import { FolderInput, LayoutGrid, Plus, Server } from "@lucide/svelte";
	import { onMount, type Snippet } from "svelte";
	import { resolve } from "$app/paths";
	import EntityList from "$lib/components/entity-list.svelte";
	import PreviewRows from "$lib/components/preview-rows.svelte";
	import ServiceContextMenu from "$lib/components/service-context-menu.svelte";
	import ServiceMenuHost from "$lib/components/service-menu-host.svelte";
	import ServiceTree from "$lib/components/service-tree.svelte";
	import StackDiagram from "$lib/components/stack-diagram.svelte";
	import StackMoveDialog from "$lib/components/stack-move-dialog.svelte";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import UnlinkDialog, {
		type UnlinkTarget,
	} from "$lib/components/unlink-dialog.svelte";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import {
		dependencyForest,
		type GraphServiceInfo,
		previewsByParent,
	} from "$lib/service-graph";
	import { flattenStackTree, type StackNode } from "$lib/stack-tree";
	import { title } from "$lib/store/title";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();
	const stack = $derived(data.stack);

	onMount(() => title.set(stack.name));

	const view = new ViewMode("stack-services");
	let menuHost = $state<ReturnType<typeof ServiceMenuHost>>();
	let moveOpen = $state(false);
	let moveTarget = $state<StackNode | null>(null);
	let unlinkOpen = $state(false);
	let unlink = $state<UnlinkTarget | null>(null);
	let search = $state("");

	const ARCHITECTURE_KEY = "homerun:stack-architecture";
	let architecture = $state(true);

	onMount(() => {
		try {
			architecture = localStorage.getItem(ARCHITECTURE_KEY) !== "off";
		} catch {
			architecture = true;
		}
	});

	/** Turns the tree and diagram on or off, remembered in this browser. */
	function setArchitecture(on: boolean) {
		architecture = on;
		try {
			localStorage.setItem(ARCHITECTURE_KEY, on ? "on" : "off");
		} catch {
			return;
		}
	}

	const services = $derived(
		new Map(data.graph.services.map((svc) => [svc.id, svc])),
	);
	const depMap = $derived(new Map(Object.entries(data.graph.deps)));
	const previews = $derived(previewsByParent(data.graph.previews));
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
			[
				svc.name,
				svc.slug,
				svc.image,
				...(previews.get(svc.id) ?? []).flatMap((p) => [
					p.name,
					p.title ?? "",
					p.branch ?? "",
				]),
			]
				.join(" ")
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
    <div class="mt-5 flex flex-wrap justify-center gap-2">
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
      class="sm:max-w-xs"
      placeholder="Search services…"
      type="search"
      bind:value={search}
    />
    <p class="text-text-subtle hidden text-xs sm:block {architecture ? '' : 'sm:hidden'}">
      {view.current === "card"
        ? "Arrows point from a service to what it connects to."
        : "Each service lists what it connects to underneath."}
      Connections are read from env vars pointing at another service's slug.
    </p>
    <div class="ml-auto flex items-center gap-3">
      <label class="text-text-muted flex items-center gap-2 text-xs">
        <Switch checked={architecture} onCheckedChange={setArchitecture} />
        Architecture
      </label>
      <ViewModeToggle {view} />
    </div>
  </div>

  {#if search.trim() || !architecture}
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
      >
        {#snippet details(item: { id: string })}
          <PreviewRows class="ml-4 sm:ml-11" previews={previews.get(item.id) ?? []} />
        {/snippet}
        {#snippet media(item: { id: string })}
          {@const svc = services.get(item.id)}
          <TemplateIcon
            category={svc?.category ?? null}
            class="size-8 rounded-lg"
            fallback={Server}
            icon={svc?.icon ?? null}
          />
        {/snippet}
      </EntityList>
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
        <section
          class="ml-[calc(var(--depth)*0.75rem)] sm:ml-[calc(var(--depth)*1.5rem)]"
          style:--depth={depth}
        >
          {#if section.id !== stack.id}
            <ContextMenu.Root>
              <ContextMenu.Trigger class="mb-2 inline-block">
                <a
                  class="eyebrow text-text-muted hover:text-text"
                  href={resolve("/(protected)/stacks/[stackId]", {
                    stackId: section.id,
                  })}
                >
                  {section.name}
                </a>
              </ContextMenu.Trigger>
              <ContextMenu.Content class="w-48">
                <ContextMenu.Item
                  onSelect={() => {
                    moveTarget = section;
                    moveOpen = true;
                  }}
                >
                  <FolderInput class="size-4" />
                  Move into…
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          {/if}
          {#if forest.length > 0}
            <ServiceTree
              localStackIds={new Set([section.id])}
              nodes={forest}
              {previews}
              {services}
              {stackNames}
              {wrapper}
            />
          {:else if !sections.some(({ stack: s }) => s.parentId === section.id)}
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
    links={data.graph.links[svc.id] ?? []}
    onunlink={(from, to) => {
      unlink = {
        from: { id: from.id, name: from.name },
        keys: to.keys,
        to: { id: to.id, name: to.name },
      };
      unlinkOpen = true;
    }}
    service={svc}
  >
    {@render body()}
  </ServiceContextMenu>
{/snippet}

<UnlinkDialog link={unlink} bind:open={unlinkOpen} />

<StackMoveDialog stack={moveTarget} stacks={data.stacks} bind:open={moveOpen} />

<ServiceMenuHost
  bind:this={menuHost}
  actionBase={resolve("/services")}
  services={data.allServices}
  stacks={data.stacks}
/>
