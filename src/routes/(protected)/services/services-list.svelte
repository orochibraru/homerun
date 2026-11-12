<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page as appPage } from "$app/state";
	import {
		Activity,
		Boxes,
		ChevronDown,
		CircleAlert,
		CirclePlay,
		CircleStop,
		Layers,
		LayoutGridIcon,
		List,
		Network,
		Plus,
		Server,
	} from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import * as DropdownMenu from "@zedensix/ui/dropdown-menu";
	import type { Snippet } from "svelte";

	import EntityToolbar, {
		type FilterGroup,
	} from "#lib/components/entity-toolbar.svelte";
	import Pagination from "#lib/components/pagination.svelte";
	import ServiceContextMenu from "#lib/components/service-context-menu.svelte";
	import ServiceMenuHost from "#lib/components/service-menu-host.svelte";
	import StackDiagram from "#lib/components/stack-diagram.svelte";
	import { SERVICE_STATUS_CONFIG, UNGROUPED_LABEL } from "#lib/constants.js";
	import { stackHues } from "#lib/lanes.js";
	import { ListSelection } from "#lib/list-selection.svelte.js";
	import { BASE_SORTS } from "#lib/list-sorts.js";
	import { getLanes } from "#lib/remote/lanes.remote.js";
	import { syncServiceStatuses } from "#lib/remote/service-status.remote.js";
	import { getServiceUsage } from "#lib/remote/stats.remote.js";
	import type {
		ServiceFacets,
		ServiceListing,
	} from "#lib/server/service-listing.js";
	import { primaryHostname } from "#lib/service-domains.js";
	import {
		dependencyForest,
		type DependencyNode,
		type GraphServiceInfo,
		matchesServiceQuery,
		type PreviewRow,
		previewsByParent,
	} from "#lib/service-graph.js";
	import { ancestorIds, flattenStackTree } from "#lib/stack-tree.js";
	import type { ContainerStatus } from "#lib/types.js";

	import BulkBar from "./bulk-bar.svelte";
	import ServiceRowMenu from "./service-row-menu.svelte";
	import ServicesTable, {
		type ServiceHealth,
		type TableGroup,
		type TableRow,
		type TableService,
	} from "./services-table.svelte";

	interface Props {
		facets: ServiceFacets | undefined;
		filtered: boolean;
		listing: ServiceListing;
		page: number;
		perPage: number;
		serviceDomain: string;
		view: "diagram" | "list" | "tree";
	}

	const {
		facets,
		filtered,
		listing: data,
		page,
		perPage,
		serviceDomain,
		view: mode,
	}: Props = $props();

	const VIEWS = [
		{ icon: Layers, id: "tree", label: "Group by stack" },
		{ icon: List, id: "list", label: "Flat list" },
		{ icon: Network, id: "diagram", label: "Diagram" },
	] as const;

	const STATUS_TABS = [
		{ icon: Boxes, label: "All", statuses: [] },
		{ icon: CirclePlay, label: "Running", statuses: ["running"] },
		{ icon: CircleStop, label: "Stopped", statuses: ["stopped"] },
		{ icon: CircleAlert, label: "Failing", statuses: ["failed", "missing"] },
	] as const;

	const currentView = $derived(
		VIEWS.find((option) => option.id === mode) ?? VIEWS[0],
	);

	const filters = $derived<FilterGroup[]>([
		{
			icon: Activity,
			key: "status",
			label: "Status",
			options: (facets?.statuses ?? []).map((status) => ({
				count: facets?.statusCounts[status],
				label: SERVICE_STATUS_CONFIG[status as ContainerStatus].label,
				value: status,
			})),
		},
		{
			icon: Layers,
			key: "stack",
			label: "Stack",
			options: (facets?.stacks ?? []).map((name) => ({
				icon: Layers,
				label: name,
				value: name,
			})),
		},
	]);

	/** The URL's comma-separated values for one filter key. */
	function urlValues(key: string): string[] {
		return (appPage.url.searchParams.get(key) ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
	}

	/** This page's URL with `key` set to `value` (or removed when empty), back on page 1. */
	function hrefWith(key: string, value: string): string {
		const params = new URLSearchParams(appPage.url.search);
		if (value) {
			params.set(key, value);
		} else {
			params.delete(key);
		}
		params.delete("page");
		const query = params.toString();
		return `${resolve("services")}${query ? `?${query}` : ""}`;
	}

	const activeStatuses = $derived(urlValues("status").toSorted().join(","));

	function tabCount(statuses: readonly string[]): number | undefined {
		if (!facets) {
			return undefined;
		}
		return statuses.length === 0
			? facets.total
			: statuses.reduce(
					(total, status) => total + (facets.statusCounts[status] ?? 0),
					0,
				);
	}

	const stackNames = $derived(new Map(data.stacks.map((s) => [s.id, s.name])));
	const stackSlugs = $derived(new Map(data.stacks.map((s) => [s.id, s.slug])));

	/** Whether a dependency-tree service passes the URL's search, status and stack filters, as the server applies them to the flat list. */
	function passesFilters(svc: TableService): boolean {
		const statuses = urlValues("status");
		const stacks = urlValues("stack");
		return (
			matchesServiceQuery(svc, appPage.url.searchParams.get("q") ?? "") &&
			(statuses.length === 0 || statuses.includes(svc.currentStatus)) &&
			(stacks.length === 0 ||
				stacks.includes(stackNames.get(svc.stackId ?? "") ?? UNGROUPED_LABEL))
		);
	}

	const shown = $derived<TableService[]>(
		data.tree
			? data.tree.services.filter(passesFilters)
			: data.services.map((svc) => ({
					category: svc.category,
					containerId: svc.containerId,
					currentStatus: svc.currentStatus,
					desiredState: svc.desiredState,
					domain: primaryHostname(
						svc,
						stackSlugs.get(svc.stackId ?? ""),
						serviceDomain,
					),
					icon: svc.icon,
					id: svc.id,
					image: `${svc.image}:${svc.tag}`,
					name: svc.name,
					slug: svc.slug,
					stackId: svc.stackId,
					swarmServiceId: svc.swarmServiceId,
				})),
	);

	const previews = $derived<Map<string, PreviewRow[]>>(
		data.tree
			? previewsByParent(data.tree.previews)
			: new Map(data.services.map((svc) => [svc.id, svc.previews])),
	);

	/** Flattens a dependency forest into table rows, each with the guide rails drawn left of it; a service already shown higher up isn't repeated. */
	function flatten(
		forest: DependencyNode[],
		byId: Map<string, TableService>,
	): TableRow[] {
		const rows: TableRow[] = [];
		const walk = (nodes: DependencyNode[], level: number, rails: boolean[]) => {
			const visible = nodes.filter((node) => !node.repeat && byId.has(node.id));
			visible.forEach((node, i) => {
				const service = byId.get(node.id);
				if (!service) {
					return;
				}
				const last = i === visible.length - 1;
				rows.push({ last, level, rails, service });
				walk(node.children, level + 1, level === 0 ? [] : [...rails, !last]);
			});
		};
		walk(forest, 0, []);
		return rows;
	}

	/** One stack's services as rows, each drawn under the service in the same stack that depends on it. */
	function treeRows(services: TableService[]): TableRow[] {
		const byId = new Map(services.map((svc) => [svc.id, svc]));
		const deps = new Map(
			services.map((svc) => [
				svc.id,
				(data.tree?.deps[svc.id] ?? []).filter((id) => byId.has(id)),
			]),
		);
		return flatten(
			dependencyForest(
				services.map((svc) => svc.id),
				deps,
			),
			byId,
		);
	}

	const groups = $derived.by<TableGroup[]>(() => {
		if (mode === "list") {
			return [
				{
					depth: 0,
					key: "all",
					label: "",
					rows: shown.map((service) => ({
						last: true,
						level: 0,
						rails: [],
						service,
					})),
				},
			];
		}
		const byStack = new Map<string | null, TableService[]>();
		for (const svc of shown) {
			const key = svc.stackId ?? null;
			byStack.set(key, [...(byStack.get(key) ?? []), svc]);
		}
		const parents = new Map(data.stacks.map((s) => [s.id, s.parentId]));
		const used = new Set(
			[...byStack.keys()]
				.filter((id): id is string => id !== null)
				.flatMap((id) => [id, ...ancestorIds(id, parents)]),
		);
		const stacked = flattenStackTree(
			data.stacks.filter((s) => used.has(s.id)),
		).map(({ depth, stack }) => ({
			depth,
			key: stack.id,
			label: stack.name,
			rows: treeRows(byStack.get(stack.id) ?? []),
		}));
		const ungrouped = byStack.get(null);
		return ungrouped
			? [
					...stacked,
					{
						depth: 0,
						key: "ungrouped",
						label: UNGROUPED_LABEL,
						rows: treeRows(ungrouped),
					},
				]
			: stacked;
	});

	const selection = new ListSelection(() =>
		mode === "diagram" ? [] : shown.map((svc) => svc.id),
	);

	const synced = $derived(
		syncServiceStatuses(
			shown
				.filter((svc) => svc.containerId || svc.swarmServiceId)
				.map((svc) => svc.id),
		),
	);
	const liveStatus = $derived(
		new Map((synced.current ?? []).map((row) => [row.id, row.status])),
	);

	const liveHealth = $derived(
		new Map(
			(synced.current ?? []).map((row) => [
				row.id,
				{ health: row.health, reason: row.healthReason },
			]),
		),
	);

	function statusOf(svc: TableService): ContainerStatus {
		return liveStatus.get(svc.id) ?? (svc.currentStatus as ContainerStatus);
	}

	function healthOf(svc: TableService): ServiceHealth {
		return liveHealth.get(svc.id) ?? { health: null, reason: null };
	}

	const lanes = $derived(
		getLanes((data.tree?.services ?? data.services).map((svc) => svc.id)),
	);
	const usageQuery = getServiceUsage();
	const usage = $derived(
		new Map((usageQuery.current ?? []).map((row) => [row.id, row])),
	);

	const hues = $derived(stackHues(data.stacks));

	let menuHost = $state<ReturnType<typeof ServiceMenuHost>>();
</script>

<div class={selection.count > 0 ? "pb-28" : ""}>
	{#if data.total === 0 && !filtered}
		<div
			class="border-border flex flex-col items-center justify-center rounded-2xl border border-dashed py-20 text-center"
		>
			<Server class="text-text-muted mb-3 size-10 opacity-40" />
			<p class="text-text-muted text-sm font-medium">No services yet</p>
			<p class="text-text-subtle mt-1 text-xs">
				Point at an image, fill in a config, and deploy.
			</p>

			<div class="flex flex-wrap items-center justify-center gap-2">
				<Button class="mt-5" href={resolve("services/new")} size="sm"
					><Plus class="size-4" />Deploy your first service</Button
				>

				<Button
					class="mt-5"
					href={resolve("templates")}
					size="sm"
					variant="outline"
				>
					<LayoutGridIcon class="size-4" />
					Start from a template
				</Button>
			</div>
		</div>
	{:else}
		<div class="-mb-2.5">
			<EntityToolbar
				sorts={mode === "list" ? BASE_SORTS : []}
				{filters}
				placeholder="Search services…"
			>
				{#snippet trailing()}
					{@render statusTabs()}
					{@render viewPicker()}
				{/snippet}
			</EntityToolbar>
		</div>

		{#if shown.length === 0}
			<div
				class="border-border/70 rounded-2xl border border-dashed py-16 text-center"
			>
				<p class="text-text-muted text-sm">No services match your filters.</p>
			</div>
		{:else if mode === "diagram" && data.tree}
			<StackDiagram
				deps={data.tree.deps}
				{hues}
				lanes={lanes.current ?? null}
				rootStackId={null}
				services={shown}
				{stackNames}
				stacks={data.stacks}
				{wrapper}
			/>
		{:else}
			<ServicesTable
				{actions}
				{groups}
				lanes={lanes.current ?? null}
				{previews}
				{selection}
				showGroups={mode === "tree"}
				health={healthOf}
				status={statusOf}
				{usage}
				{wrapper}
			/>

			{#if mode === "list"}
				<Pagination label="services" {page} {perPage} total={data.total} />
			{/if}
		{/if}
	{/if}
</div>

{#snippet statusTabs()}
	<nav
		class="bg-surface ring-border-light order-first inline-flex h-10 shrink-0 items-center rounded-full p-0.75 ring-1"
		aria-label="Filter by status"
	>
		{#each STATUS_TABS as tab (tab.label)}
			{@const active = activeStatuses === tab.statuses.join(",")}
			{@const count = tabCount(tab.statuses)}
			{@const TabIcon = tab.icon}
			<a
				class="flex h-full items-center gap-1.5 rounded-full px-3.5 text-[0.78rem] font-bold transition-colors {active
					? 'bg-primary text-primary-foreground'
					: 'text-text-muted hover:text-text'}"
				aria-current={active ? "page" : undefined}
				href={hrefWith("status", tab.statuses.join(","))}
			>
				<TabIcon class="size-3.5 shrink-0" />
				{tab.label}
				{#if count !== undefined}
					<small class="font-semibold opacity-60">{count}</small>
				{/if}
			</a>
		{/each}
	</nav>
{/snippet}

{#snippet viewPicker()}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					class="bg-surface ring-border-light text-text-muted hover:text-text order-first inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.78rem] font-semibold ring-1 transition-colors"
					type="button"
				>
					<currentView.icon class="size-3.5" />
					{currentView.label}
					<ChevronDown class="size-3.5" />
				</button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="w-48">
			{#each VIEWS as option (option.id)}
				<DropdownMenu.Item
					onSelect={() =>
						goto(hrefWith("view", option.id === "tree" ? "" : option.id))}
				>
					<option.icon class="size-4" />
					{option.label}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

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

{#snippet actions(svc: TableService)}
	<ServiceRowMenu
		onaction={(op, id) => menuHost?.run(op, id)}
		ongroup={(s) => menuHost?.group(s)}
		onlink={(s) => menuHost?.link(s)}
		onungroup={(s) => menuHost?.ungroup(s)}
		service={svc}
	/>
{/snippet}

<BulkBar {selection} />

<ServiceMenuHost
	bind:this={menuHost}
	services={data.tree?.services ?? data.services}
	stacks={data.stacks}
/>
