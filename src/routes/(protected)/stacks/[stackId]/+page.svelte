<script lang="ts">
	import { resolve } from "$app/paths";
	import {
		ChevronRight,
		FolderInput,
		FolderKanban,
		LayoutGrid,
		Plus,
		Server,
	} from "@lucide/svelte";
	import { onMount, type Snippet } from "svelte";

	import EntityList from "#lib/components/entity-list.svelte";
	import PreviewRows from "#lib/components/preview-rows.svelte";
	import ServiceContextMenu from "#lib/components/service-context-menu.svelte";
	import ServiceMenuHost from "#lib/components/service-menu-host.svelte";
	import ServiceTree from "#lib/components/service-tree.svelte";
	import StackDiagram from "#lib/components/stack-diagram.svelte";
	import StackMoveDialog from "#lib/components/stack-move-dialog.svelte";
	import StatusDot from "#lib/components/status-dot.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as ContextMenu from "#lib/components/ui/context-menu/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { Switch } from "#lib/components/ui/switch/index.js";
	import UnlinkDialog, {
		type UnlinkTarget,
	} from "#lib/components/unlink-dialog.svelte";
	import ViewModeToggle from "#lib/components/view-mode-toggle.svelte";
	import {
		dependencyForest,
		type GraphServiceInfo,
		previewsByParent,
	} from "#lib/service-graph.js";
	import { flattenStackTree, type StackNode } from "#lib/stack-tree.js";
	import { title } from "#lib/store/title.js";
	import { ViewMode } from "#lib/view-mode.svelte.js";

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
				...(previews.get(svc.id) ?? []).flatMap((p) =>
					p.kind === "preview"
						? [p.name, p.title ?? "", p.branch ?? ""]
						: [p.name, p.kind === "environment" ? p.environment : ""],
				),
			]
				.join(" ")
				.toLowerCase()
				.includes(search.trim().toLowerCase()),
		),
	);

	const usedBy = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const [from, targets] of depMap) {
			const name = services.get(from)?.name;
			if (!name) {
				continue;
			}
			for (const target of targets) {
				map.set(target, [...(map.get(target) ?? []), name]);
			}
		}
		return map;
	});
	const running = $derived(
		members.filter((svc) => svc.currentStatus === "running").length,
	);
	const parents = $derived(
		new Map(data.graph.stacks.map((s) => [s.id, s.parentId])),
	);
	let collapsed = $state<string[]>([]);

	/** Opens or folds one substack's rows. */
	function toggle(id: string) {
		collapsed = collapsed.includes(id)
			? collapsed.filter((c) => c !== id)
			: [...collapsed, id];
	}

	/** Whether a substack sits under a folded one, so its header is hidden too. */
	function hidden(id: string): boolean {
		let parent = parents.get(id);
		while (parent && parent !== stack.id) {
			if (collapsed.includes(parent)) {
				return true;
			}
			parent = parents.get(parent);
		}
		return false;
	}

	/** How many of a stack's own services exist and how many of them run. */
	function healthOf(stackId: string) {
		const own = members.filter((svc) => svc.stackId === stackId);
		return {
			running: own.filter((svc) => svc.currentStatus === "running").length,
			total: own.length,
		};
	}

	function forestFor(stackId: string) {
		return dependencyForest(
			members.filter((svc) => svc.stackId === stackId).map((svc) => svc.id),
			depMap,
		);
	}
</script>

{#if members.length === 0 && data.graph.stacks.length === 1}
	<div
		class="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center"
	>
		<Server class="text-text-subtle mb-3 size-8" />
		<p class="text-text-muted text-sm font-medium">
			No services in this stack yet
		</p>
		<div class="mt-5 flex flex-wrap justify-center gap-2">
			<Button href="{resolve('templates')}?stackId={stack.id}" variant="outline"
				><LayoutGrid class="size-4" />From Template</Button
			>

			<Button href="{resolve('services/new')}?stackId={stack.id}"
				><Plus class="size-4" />Add Service</Button
			>
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
		<p
			class="text-text-muted hidden text-xs sm:block"
			title="{view.current === 'card'
				? 'Arrows point from a service to what it connects to.'
				: 'Each service lists what it connects to underneath.'} Connections are read from env vars pointing at another service's slug."
		>
			{members.length}
			{members.length === 1 ? "service" : "services"} ·
			<span
				class={running === members.length
					? "text-emerald-600 dark:text-emerald-400"
					: "text-amber-600 dark:text-amber-400"}
			>
				{running === members.length
					? "all running"
					: `${running} of ${members.length} running`}
			</span>
		</p>
		<div class="ml-auto flex items-center gap-3">
			{#if architecture && !search.trim() && view.current !== "card" && sections.length > 1}
				<Button
					onclick={() =>
						(collapsed =
							collapsed.length > 0
								? []
								: sections
										.map(({ stack: s }) => s.id)
										.filter((id) => id !== stack.id))}
					size="sm"
					variant="ghost"
				>
					{collapsed.length > 0 ? "Expand all" : "Collapse all"}
				</Button>
			{/if}
			<label class="text-text-muted flex items-center gap-2 text-xs">
				<Switch checked={architecture} onCheckedChange={setArchitecture} />
				Architecture
			</label>
			<ViewModeToggle {view} />
		</div>
	</div>

	{#if search.trim() || !architecture}
		{#if matches.length === 0}
			<div
				class="border-border/70 rounded-xl border border-dashed py-12 text-center"
			>
				<p class="text-text-muted text-sm">No services match your search.</p>
			</div>
		{:else}
			<EntityList
				items={matches.map((svc) => ({
					description: svc.image,
					href: `${resolve("services")}/${svc.id}`,
					id: svc.id,
					subtitle: svc.slug,
					title: svc.name,
				}))}
				{view}
			>
				{#snippet details(item: { id: string })}
					<PreviewRows
						class="ml-4 sm:ml-11"
						previews={previews.get(item.id) ?? []}
					/>
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
		<div class="panel overflow-hidden rounded-xl">
			{#each sections as { depth, stack: section } (section.id)}
				{#if !hidden(section.id)}
					{@const forest = forestFor(section.id)}
					{@const health = healthOf(section.id)}
					{#if section.id !== stack.id}
						<div
							class="bg-surface-2/60 border-border/60 flex h-11 items-center gap-2 border-y pr-4 pl-[calc(0.5rem+var(--depth)*1.25rem)] first:border-t-0"
							style:--depth={depth - 1}
						>
							<button
								class="text-text-subtle hover:text-text grid size-6 shrink-0 place-items-center rounded-md transition-colors"
								aria-expanded={!collapsed.includes(section.id)}
								aria-label={collapsed.includes(section.id)
									? `Expand ${section.name}`
									: `Collapse ${section.name}`}
								onclick={() => toggle(section.id)}
								type="button"
							>
								<ChevronRight
									class="size-4 transition-transform {collapsed.includes(
										section.id,
									)
										? ''
										: 'rotate-90'}"
								/>
							</button>
							<ContextMenu.Root>
								<ContextMenu.Trigger class="min-w-0">
									<a
										class="text-text hover:text-accent flex min-w-0 items-center gap-2.5 text-sm font-semibold transition-colors"
										href={resolve("/(protected)/stacks/[stackId]", {
											stackId: section.id,
										})}
									>
										<TemplateIcon
											class="size-6 shrink-0 rounded-md"
											fallback={FolderKanban}
											icon={section.icon ?? null}
										/>
										<span class="truncate">{section.name}</span>
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
							<span class="text-text-subtle shrink-0 text-xs">
								{health.total}
								{health.total === 1 ? "service" : "services"}
							</span>
							<span class="flex-1"></span>
							{#if health.total > 0}
								<span
									class="flex shrink-0 items-center gap-2 text-xs {health.running ===
									health.total
										? 'text-emerald-600 dark:text-emerald-400'
										: 'text-amber-600 dark:text-amber-400'}"
								>
									<StatusDot
										status={health.running === health.total
											? "running"
											: "stopped"}
									/>
									{health.running === health.total
										? "all running"
										: `${health.running} of ${health.total} running`}
								</span>
							{/if}
						</div>
					{/if}
					{#if !collapsed.includes(section.id)}
						{#if forest.length > 0}
							<ServiceTree
								depth={section.id === stack.id ? 0 : depth}
								localStackIds={new Set([section.id])}
								nodes={forest}
								{previews}
								{services}
								{stackNames}
								{usedBy}
								{wrapper}
							/>
						{:else if !sections.some(({ stack: s }) => s.parentId === section.id)}
							<p
								class="text-text-subtle py-3 pr-4 pl-[calc(2.75rem+var(--depth)*1.25rem)] text-xs"
								style:--depth={depth - 1}
							>
								No services yet.
							</p>
						{/if}
					{/if}
				{/if}
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
	actionBase={resolve("services")}
	services={data.allServices}
	stacks={data.stacks}
/>
