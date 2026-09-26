<script lang="ts">
	import { Server } from "@lucide/svelte";
	import { type Snippet, tick } from "svelte";
	import { resolve } from "$app/paths";
	import type { GraphServiceInfo } from "$lib/components/service-tree.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import { type Box, edgePaths } from "$lib/diagram-edges";
	import { dependencyLayers } from "$lib/service-graph";
	import type { StackNode } from "$lib/stack-tree";
	import type { ContainerStatus } from "$lib/types";

	interface Props {
		deps: Record<string, string[]>;
		rootStackId: string;
		services: GraphServiceInfo[];
		/** Every stack's name, for a dependency outside this tree. */
		stackNames: Map<string, string>;
		stacks: StackNode[];
		/** Wraps each card, for the service context menu. */
		wrapper?: Snippet<[GraphServiceInfo, Snippet]>;
	}

	const { deps, rootStackId, services, stackNames, stacks, wrapper }: Props =
		$props();

	const localIds = $derived(new Set(stacks.map((s) => s.id)));
	const depMap = $derived(new Map(Object.entries(deps)));
	const byId = $derived(new Map(services.map((svc) => [svc.id, svc])));
	const outside = $derived(
		services.filter((svc) => !(svc.stackId && localIds.has(svc.stackId))),
	);

	function membersOf(stackId: string): string[] {
		return services.filter((svc) => svc.stackId === stackId).map((s) => s.id);
	}

	function childrenOf(stackId: string): StackNode[] {
		return stacks
			.filter((s) => s.parentId === stackId)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	let canvas = $state<HTMLDivElement | null>(null);
	let edges = $state<{ d: string; from: string; key: string; to: string }[]>(
		[],
	);
	let focused = $state<string | null>(null);
	let size = $state({ height: 0, width: 0 });

	/** Measures every card and draws a curve from each service down to what it depends on. */
	function measure() {
		if (!canvas) {
			return;
		}
		const origin = canvas.getBoundingClientRect();
		const boxes = new Map<string, Box>();
		for (const el of canvas.querySelectorAll<HTMLElement>("[data-node]")) {
			const r = el.getBoundingClientRect();
			boxes.set(el.dataset.node ?? "", {
				bottom: r.bottom - origin.top,
				left: r.left - origin.left,
				right: r.right - origin.left,
				top: r.top - origin.top,
			});
		}
		const next = edgePaths(
			[...depMap].flatMap(([from, targets]) =>
				targets.map((to) => ({ from, to })),
			),
			boxes,
		);
		edges = next;
		size = { height: canvas.scrollHeight, width: canvas.scrollWidth };
	}

	$effect(() => {
		if (!canvas) {
			return;
		}
		void services;
		void deps;
		void tick().then(measure);
		const observer = new ResizeObserver(() => measure());
		observer.observe(canvas);
		return () => observer.disconnect();
	});
</script>

{#snippet card(svc: GraphServiceInfo)}
  {#snippet body()}
    <a
      class="border-border bg-bg hover:border-border-light flex w-72 items-center gap-2.5 rounded-lg border px-3 py-2 shadow-sm transition-colors"
      data-node={svc.id}
      href={`${resolve("/services")}/${svc.id}`}
      onblur={() => (focused = null)}
      onfocus={() => (focused = svc.id)}
      onmouseenter={() => (focused = svc.id)}
      onmouseleave={() => (focused = null)}
    >
      <TemplateIcon
        category={svc.category}
        class="size-7 rounded-md"
        fallback={Server}
        icon={svc.icon}
      />
      <span class="min-w-0 flex-1">
        <span class="text-text block truncate text-sm font-medium">{svc.name}</span>
        <span class="text-text-subtle block truncate font-mono text-[0.6875rem]">
          {svc.slug}
        </span>
      </span>
      <StatusBadge status={svc.currentStatus as ContainerStatus} />
    </a>
  {/snippet}
  {#if wrapper}
    {@render wrapper(svc, body)}
  {:else}
    {@render body()}
  {/if}
{/snippet}

{#snippet layers(ids: string[])}
  {#each dependencyLayers(ids, depMap) as row, i (i)}
    <div class="flex flex-wrap justify-center gap-4">
      {#each row as id (id)}
        {@const svc = byId.get(id)}
        {#if svc}
          {@render card(svc)}
        {/if}
      {/each}
    </div>
  {/each}
{/snippet}

{#snippet group(stack: StackNode, depth: number)}
  {@const members = membersOf(stack.id)}
  {@const children = childrenOf(stack.id)}
  <section
    class="border-border rounded-xl border p-4 {depth === 0
      ? 'bg-transparent'
      : 'bg-surface-2/40'}"
  >
    {#if depth > 0}
      <a
        class="eyebrow text-text-muted hover:text-text mb-3 inline-block"
        href={resolve("/(protected)/stacks/[stackId]", { stackId: stack.id })}
      >
        {stack.name}
      </a>
    {/if}
    <div class="space-y-10">
      {#if members.length > 0}
        {@render layers(members)}
      {:else if children.length === 0}
        <p class="text-text-subtle text-center text-xs">No services yet.</p>
      {/if}
      {#if children.length > 0}
        <div class="flex flex-wrap items-start justify-center gap-6">
          {#each children as child (child.id)}
            {@render group(child, depth + 1)}
          {/each}
        </div>
      {/if}
    </div>
  </section>
{/snippet}

<div class="relative overflow-x-auto" bind:this={canvas}>
  <svg
    class="text-text-subtle pointer-events-none absolute top-0 left-0"
    aria-hidden="true"
    height={size.height}
    width={size.width}
  >
    <defs>
      <marker
        id="stack-diagram-arrow"
        markerHeight="6"
        markerWidth="6"
        orient="auto-start-reverse"
        refX="5"
        refY="3"
        viewBox="0 0 6 6"
      >
        <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
      </marker>
    </defs>
    {#each edges as edge (edge.key)}
      {@const lit = focused === edge.from || focused === edge.to}
      <path
        class="transition-opacity {lit ? 'text-accent' : ''} {focused && !lit
          ? 'opacity-15'
          : ''}"
        d={edge.d}
        fill="none"
        marker-end="url(#stack-diagram-arrow)"
        stroke="currentColor"
        stroke-width="1.5"
      />
    {/each}
  </svg>
  <div class="relative space-y-8 p-1">
    {#each stacks.filter((s) => s.id === rootStackId) as root (root.id)}
      {@render group(root, 0)}
    {/each}
    {#if outside.length > 0}
      <section class="border-border rounded-xl border border-dashed p-4">
        <p class="eyebrow text-text-muted mb-3">Outside this stack</p>
        <div class="flex flex-wrap justify-center gap-4">
          {#each outside as svc (svc.id)}
            <div class="flex flex-col items-center gap-1">
              {@render card(svc)}
              <span class="text-text-subtle text-[0.6875rem]">
                {svc.stackId
                  ? (stackNames.get(svc.stackId) ?? "another stack")
                  : "no stack"}
              </span>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</div>
