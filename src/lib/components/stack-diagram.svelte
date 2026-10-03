<script lang="ts">
	import {
		FolderKanban,
		Maximize,
		Minus,
		Plus,
		RotateCcw,
		Server,
	} from "@lucide/svelte";
	import { type Snippet, tick } from "svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { type Box, edgePaths } from "#lib/diagram-edges.js";
	import {
		dependencyLayers,
		type GraphServiceInfo,
	} from "#lib/service-graph.js";
	import type { StackNode } from "#lib/stack-tree.js";
	import type { ContainerStatus } from "#lib/types.js";
	import { resolve } from "$app/paths";

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

	let viewport = $state<HTMLDivElement | null>(null);
	let canvas = $state<HTMLDivElement | null>(null);
	let edges = $state<{ d: string; from: string; key: string; to: string }[]>(
		[],
	);
	let focused = $state<string | null>(null);

	type Offsets = Record<string, { x: number; y: number }>;
	const MIN_ZOOM = 0.2;
	const MAX_ZOOM = 2;
	const FIT_PADDING = 32;
	const storageKey = $derived(`homerun:stack-diagram:${rootStackId}`);
	let offsets = $state<Offsets>({});
	let view = $state({ x: 0, y: 0, zoom: 1 });
	let drag: {
		key: string | null;
		moved: boolean;
		originX: number;
		originY: number;
		startX: number;
		startY: number;
	} | null = null;
	let suppressClick = false;

	$effect(() => {
		try {
			offsets = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Offsets;
		} catch {
			offsets = {};
		}
	});

	/** Remembers where the cards and substacks were dragged to, in this browser only. */
	function saveOffsets() {
		try {
			localStorage.setItem(storageKey, JSON.stringify(offsets));
		} catch {
			return;
		}
	}

	/** Puts every card and substack back where the layout puts it. */
	function resetLayout() {
		offsets = {};
		saveOffsets();
		void tick().then(measure);
	}

	/** Where `key` (a service id, `stack:<id>` or `outside`) has been dragged to, as a CSS transform. */
	function offsetOf(key: string): string | undefined {
		const at = offsets[key];
		return at ? `translate(${at.x}px, ${at.y}px)` : undefined;
	}

	/**
	 * Starts dragging `key` with the primary button, or panning the canvas
	 * when `key` is null. The innermost element under the pointer wins: a
	 * card inside a substack drags the card, not the substack.
	 */
	function beginDrag(event: PointerEvent, key: string | null) {
		if (drag || event.button !== 0) {
			return;
		}
		suppressClick = false;
		const at = key === null ? view : (offsets[key] ?? { x: 0, y: 0 });
		drag = {
			key,
			moved: false,
			originX: at.x,
			originY: at.y,
			startX: event.clientX,
			startY: event.clientY,
		};
		window.addEventListener("pointermove", moveDrag);
		window.addEventListener("pointerup", endDrag);
		window.addEventListener("pointercancel", endDrag);
	}

	/** Moves the dragged card or substack, or pans, once past a click's wobble. */
	function moveDrag(event: PointerEvent) {
		if (!drag) {
			return;
		}
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < 4) {
			return;
		}
		drag.moved = true;
		if (drag.key === null) {
			view.x = drag.originX + dx;
			view.y = drag.originY + dy;
			return;
		}
		offsets[drag.key] = {
			x: drag.originX + dx / view.zoom,
			y: drag.originY + dy / view.zoom,
		};
		measure();
	}

	/** Ends the drag, keeping the click that ends one from opening a link. */
	function endDrag() {
		window.removeEventListener("pointermove", moveDrag);
		window.removeEventListener("pointerup", endDrag);
		window.removeEventListener("pointercancel", endDrag);
		if (drag?.moved) {
			suppressClick = true;
			if (drag.key !== null) {
				saveOffsets();
			}
		}
		drag = null;
	}

	/** Zooms by `factor`, keeping the canvas point under (`px`, `py`) in place. */
	function zoomAt(px: number, py: number, factor: number) {
		const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
		view = {
			x: px - (px - view.x) * (zoom / view.zoom),
			y: py - (py - view.y) * (zoom / view.zoom),
			zoom,
		};
	}

	/** Zooms around the middle of the visible canvas. */
	function zoomBy(factor: number) {
		if (viewport) {
			zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
		}
	}

	/** Frames every card and substack in the visible canvas, never zooming past 100%. */
	function fit() {
		if (!(viewport && canvas)) {
			return;
		}
		const boxes = [...boxesIn(canvas, "[data-node], [data-group]").values()];
		if (boxes.length === 0) {
			view = { x: 0, y: 0, zoom: 1 };
			return;
		}
		const left = Math.min(...boxes.map((b) => b.left));
		const top = Math.min(...boxes.map((b) => b.top));
		const width = Math.max(...boxes.map((b) => b.right)) - left;
		const height = Math.max(...boxes.map((b) => b.bottom)) - top;
		const zoom = Math.max(
			MIN_ZOOM,
			Math.min(
				1,
				(viewport.clientWidth - FIT_PADDING * 2) / width,
				(viewport.clientHeight - FIT_PADDING * 2) / height,
			),
		);
		view = {
			x: (viewport.clientWidth - width * zoom) / 2 - left * zoom,
			y:
				Math.max(FIT_PADDING, (viewport.clientHeight - height * zoom) / 2) -
				top * zoom,
			zoom,
		};
	}

	$effect(() => {
		if (!viewport) {
			return;
		}
		const el = viewport;
		function onWheel(event: WheelEvent) {
			event.preventDefault();
			if (event.ctrlKey || event.metaKey) {
				const r = el.getBoundingClientRect();
				zoomAt(
					event.clientX - r.left,
					event.clientY - r.top,
					Math.exp(-event.deltaY * 0.01),
				);
				return;
			}
			view.x -= event.deltaX;
			view.y -= event.deltaY;
		}
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	});

	let size = $state({ height: 0, width: 0 });

	/** Every element matching `selector` under `root`, as boxes in the canvas's own unzoomed coordinates. */
	function boxesIn(root: HTMLElement, selector: string): Map<string, Box> {
		const origin = root.getBoundingClientRect();
		const boxes = new Map<string, Box>();
		for (const el of root.querySelectorAll<HTMLElement>(selector)) {
			const r = el.getBoundingClientRect();
			boxes.set(el.dataset.node ?? el.dataset.group ?? "", {
				bottom: (r.bottom - origin.top) / view.zoom,
				left: (r.left - origin.left) / view.zoom,
				right: (r.right - origin.left) / view.zoom,
				top: (r.top - origin.top) / view.zoom,
			});
		}
		return boxes;
	}

	/** Measures every card and draws a curve from each service down to what it depends on. */
	function measure() {
		if (!canvas) {
			return;
		}
		edges = edgePaths(
			[...depMap].flatMap(([from, targets]) =>
				targets.map((to) => ({ from, to })),
			),
			boxesIn(canvas, "[data-node]"),
		);
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
		return () => {
			observer.disconnect();
			endDrag();
		};
	});
</script>

{#snippet card(svc: GraphServiceInfo)}
	{#snippet body()}
		<a
			class="border-border bg-bg hover:border-border-light relative flex w-72 cursor-grab items-center gap-2.5 rounded-lg border px-3 py-2 shadow-sm transition-colors"
			data-node={svc.id}
			draggable="false"
			href={`${resolve('services')}/${svc.id}`}
			onpointerdown={(event) => beginDrag(event, svc.id)}
			style:transform={offsetOf(svc.id)}
			onblur={() => focused = null}
			onfocus={() => focused = svc.id}
			onmouseenter={() => focused = svc.id}
			onmouseleave={() => focused = null}
		>
			<TemplateIcon
				category={svc.category}
				class="size-7 rounded-md"
				fallback={Server}
				icon={svc.icon}
			/>
			<span class="min-w-0 flex-1">
				<span
					class="text-text block truncate text-sm font-medium"
				>{svc.name}</span>

				<span
					class="text-text-subtle block truncate font-mono text-[0.6875rem]"
				>{svc.slug}</span>
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
      : 'bg-surface-2/40 cursor-grab'}"
    aria-label={stack.name}
    data-group={stack.id}
    onpointerdown={depth > 0
      ? (event) => beginDrag(event, `stack:${stack.id}`)
      : undefined}
    role="group"
    style:transform={depth > 0 ? offsetOf(`stack:${stack.id}`) : undefined}
  >
    {#if depth > 0}
      <a
        class="eyebrow text-text-muted hover:text-text mb-3 inline-flex items-center gap-2"
        draggable="false"
        href={resolve("/(protected)/stacks/[stackId]", { stackId: stack.id })}
      >
        <TemplateIcon
          class="size-7 rounded-md"
          fallback={FolderKanban}
          icon={stack.icon ?? null}
        />
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

<div class="mb-2 flex flex-wrap items-center justify-end gap-2">
  <p class="text-text-subtle mr-auto hidden text-xs md:block">
    Drag the background to pan, scroll to move around, Ctrl or ⌘ and scroll to
    zoom. Drag a card or a substack to rearrange it.
  </p>
  {#if Object.keys(offsets).length > 0}
    <Button onclick={resetLayout} size="sm" variant="outline">
      <RotateCcw class="size-4" />
      Reset layout
    </Button>
  {/if}
  <div class="flex items-center">
    <Button
      aria-label="Zoom out"
      onclick={() => zoomBy(1 / 1.2)}
      size="icon-sm"
      variant="ghost"
    >
      <Minus class="size-4" />
    </Button>
    <span class="text-text-muted w-12 text-center text-xs tabular-nums">
      {Math.round(view.zoom * 100)}%
    </span>
    <Button
      aria-label="Zoom in"
      onclick={() => zoomBy(1.2)}
      size="icon-sm"
      variant="ghost"
    >
      <Plus class="size-4" />
    </Button>
  </div>
  <Button onclick={fit} size="sm" variant="outline">
    <Maximize class="size-4" />
    Fit
  </Button>
</div>

<div
  class="border-border bg-surface-2/20 relative h-[70vh] min-h-96 cursor-grab touch-none overflow-hidden rounded-xl border select-none"
  onclickcapture={(event) => {
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }
  }}
  onpointerdown={(event) => beginDrag(event, null)}
  role="presentation"
  bind:this={viewport}
>
	<div
		class="absolute top-0 left-0 w-full origin-top-left"
		style:transform="translate({view.x}px, {view.y}px) scale({view.zoom})"
		bind:this={canvas}
	>
		<svg
			class="text-text-subtle pointer-events-none absolute top-0 left-0 overflow-visible"
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
				><path d="M0,0 L6,3 L0,6 z" fill="currentColor"></path></marker>
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
				></path>
			{/each}
		</svg>
		<div class="relative space-y-8 p-1">
			{#each stacks.filter((s) => s.id === rootStackId) as root (root.id)}
				{@render group(root, 0)}
			{/each}
			{#if outside.length > 0}
				<section
					class="border-border cursor-grab rounded-xl border border-dashed p-4"
					aria-label="Outside this stack"
					data-group="outside"
					onpointerdown={(event) => beginDrag(event, "outside")}
					role="group"
					style:transform={offsetOf("outside")}
				>
					<p class="eyebrow text-text-muted mb-3">Outside this stack</p>
					<div class="flex flex-wrap justify-center gap-4">
						{#each outside as svc (svc.id)}
							<div class="flex flex-col items-center gap-1">
								{@render card(svc)}
								<span class="text-text-subtle text-[0.6875rem]">
									{svc.stackId
										? stackNames.get(svc.stackId) ?? "another stack"
										: "no stack"}
								</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	</div>
</div>
