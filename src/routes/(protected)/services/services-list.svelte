<script lang="ts">
	import { resolve } from "$app/paths";
	import {
		Activity,
		CornerDownRight,
		FileUp,
		Layers,
		LayoutGridIcon,
		List,
		ListTree,
		Network,
		Plus,
		Server,
	} from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import type { Snippet } from "svelte";

	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import DeleteVolumesOption from "#lib/components/delete-volumes-option.svelte";
	import EntityList, {
		type EntityRow,
	} from "#lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "#lib/components/entity-toolbar.svelte";
	import Pagination from "#lib/components/pagination.svelte";
	import PreviewRows from "#lib/components/preview-rows.svelte";
	import SelectAllRow from "#lib/components/select-all-row.svelte";
	import ServiceContextMenu from "#lib/components/service-context-menu.svelte";
	import ServiceMenuHost from "#lib/components/service-menu-host.svelte";
	import ServiceTree from "#lib/components/service-tree.svelte";
	import StackDiagram from "#lib/components/stack-diagram.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import ViewModeToggle from "#lib/components/view-mode-toggle.svelte";
	import { SERVICE_STATUS_CONFIG, UNGROUPED_LABEL } from "#lib/constants.js";
	import { stackHues } from "#lib/lanes.js";
	import { ListSelection } from "#lib/list-selection.svelte.js";
	import { BASE_SORTS } from "#lib/list-sorts.js";
	import { getLanes } from "#lib/remote/lanes.remote.js";
	import { syncServiceStatuses } from "#lib/remote/service-status.remote.js";
	import type {
		ServiceFacets,
		ServiceListing,
	} from "#lib/server/service-listing.js";
	import {
		SERVICE_ACTION_LABELS,
		type ServiceAction,
	} from "#lib/service-actions.js";
	import { primaryHostname } from "#lib/service-domains.js";
	import {
		dependencyForest,
		type GraphServiceInfo,
		previewsByParent,
	} from "#lib/service-graph.js";
	import { ancestorIds, flattenStackTree } from "#lib/stack-tree.js";
	import { enhanceToast } from "#lib/toast.js";
	import type { ContainerStatus } from "#lib/types.js";
	import { ViewMode } from "#lib/view-mode.svelte.js";

	import BulkBar from "./bulk-bar.svelte";
	import ServiceRowActions from "./service-row-actions.svelte";

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
		{ icon: List, id: "list", label: "List" },
		{ icon: ListTree, id: "tree", label: "Dependencies" },
		{ icon: Network, id: "diagram", label: "Diagram" },
	] as const;

	type Svc = (typeof data.services)[number];

	const cardView = new ViewMode("services");

	const selection = new ListSelection(() => data.services.map((svc) => svc.id));

	const filters = $derived<FilterGroup[]>([
		{
			icon: Activity,
			key: "status",
			label: "Status",
			options: (facets?.statuses ?? []).map((status) => ({
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

	const groups = $derived.by(() => {
		const byStack = new Map<string | null, Svc[]>();
		for (const svc of data.services) {
			const key = svc.stackId ?? null;
			byStack.set(key, [...(byStack.get(key) ?? []), svc]);
		}
		const parents = new Map(data.stacks.map((s) => [s.id, s.parentId]));
		const shown = new Set(
			[...byStack.keys()]
				.filter((id): id is string => id !== null)
				.flatMap((id) => [id, ...ancestorIds(id, parents)]),
		);
		const rows = flattenStackTree(
			data.stacks.filter((s) => shown.has(s.id)),
		).map(({ depth, stack }) => ({
			depth,
			key: stack.id,
			label: stack.name,
			services: byStack.get(stack.id) ?? [],
		}));
		const ungrouped = byStack.get(null);
		return ungrouped
			? [
					...rows,
					{
						depth: 0,
						key: "ungrouped",
						label: UNGROUPED_LABEL,
						services: ungrouped,
					},
				]
			: rows;
	});

	const deployedIds = $derived(
		data.services
			.filter((svc) => svc.containerId || svc.swarmServiceId)
			.map((svc) => svc.id),
	);
	const synced = $derived(syncServiceStatuses(deployedIds));
	const liveStatus = $derived(
		new Map((synced.current ?? []).map((row) => [row.id, row.status])),
	);

	function statusOf(svc: Svc): ContainerStatus {
		return liveStatus.get(svc.id) ?? svc.currentStatus;
	}

	function byId(id: string): Svc | undefined {
		return data.services.find((svc) => svc.id === id);
	}

	// Tracks which service's action is in flight, keyed by serviceId, so
	// only that row's buttons show a spinner/disable.
	let pending = $state<Record<string, boolean>>({});

	function serviceName(serviceId: string): string {
		return (
			data.services.find((svc) => svc.id === serviceId)?.name ?? "the service"
		);
	}

	function withPending(serviceId: string, action: ServiceAction) {
		const label = SERVICE_ACTION_LABELS[action];
		return enhanceToast({
			error: `Couldn't ${label.verb} ${serviceName(serviceId)}.`,
			loading: `${label.progressive} ${serviceName(serviceId)}`,
			onSettled: () => {
				pending[serviceId] = false;
			},
			onStart: () => {
				pending[serviceId] = true;
			},
			success: `${serviceName(serviceId)} ${label.done}.`,
		});
	}

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;
	let deleteVolumes = $state(false);

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteVolumes = false;
		deleteDialogOpen = true;
	}

	let menuHost = $state<ReturnType<typeof ServiceMenuHost>>();

	const hues = $derived(stackHues(data.stacks));
	const stackNames = $derived(new Map(data.stacks.map((s) => [s.id, s.name])));
	const lanes = $derived(
		data.tree ? getLanes(data.tree.services.map((svc) => svc.id)) : null,
	);

	const tree = $derived(
		data.tree && {
			forest: dependencyForest(
				data.tree.services.map((svc) => svc.id),
				new Map(Object.entries(data.tree.deps)),
			),
			previews: previewsByParent(data.tree.previews),
			services: new Map(data.tree.services.map((svc) => [svc.id, svc])),
		},
	);
</script>

<div class={selection.count > 0 ? "pb-28" : ""}>
	{#if data.total === 0 && !filtered}
		<div
			class="border-border flex flex-col items-center justify-center rounded-md border border-dashed py-20 text-center"
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
	{:else if tree && data.tree}
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<p class="text-text-subtle text-xs">
				Every service, with what it needs underneath and its last 24 hours.
				Connections are read from env vars pointing at another service's slug.
			</p>
			<span class="ml-auto">{@render viewSwitch()}</span>
		</div>
		{#if mode === "diagram"}
			<StackDiagram
				deps={data.tree.deps}
				{hues}
				lanes={lanes?.current ?? null}
				rootStackId={null}
				services={data.tree.services}
				{stackNames}
				stacks={data.stacks}
				wrapper={treeWrapper}
			/>
		{:else}
			<div class="panel overflow-hidden rounded-xl">
				<ServiceTree
					{hues}
					lanes={lanes?.current ?? null}
					nodes={tree.forest}
					previews={tree.previews}
					services={tree.services}
					{stackNames}
					wrapper={treeWrapper}
				/>
			</div>
		{/if}
	{:else}
		<EntityToolbar
			sorts={BASE_SORTS}
			{filters}
			placeholder="Search services by name, image or domain…"
		>
			{#snippet trailing()}
				{@render viewSwitch()}
				<ViewModeToggle view={cardView} />
			{/snippet}
		</EntityToolbar>

		{#if data.services.length === 0}
			<div
				class="border-border/70 rounded-md border border-dashed py-16 text-center"
			>
				<p class="text-text-muted text-sm">No services match your filters.</p>
			</div>
		{:else}
			<SelectAllRow
				noun="services"
				{selection}
				visibleCount={data.services.length}
			/>

			{#snippet wrapper(item: EntityRow, body: import("svelte").Snippet)}
				{@const svc = byId(item.id)}
				{#if svc}
					<ServiceContextMenu
						onaction={(op, id) => menuHost?.run(op, id)}
						ongroup={(s) => menuHost?.group(s)}
						onlink={(s) => menuHost?.link(s)}
						onungroup={(s) => menuHost?.ungroup(s)}
						service={svc}
					>
						{@render body()}
					</ServiceContextMenu>
				{:else}
					{@render body()}
				{/if}
			{/snippet}

			{#snippet media(item: { id: string })}
				{@const svc = byId(item.id)}
				<TemplateIcon
					category={svc?.category ?? null}
					class="size-8 rounded-lg"
					fallback={Server}
					icon={svc?.icon ?? null}
				/>
				{#if svc}
					<span class="sr-only">{svc.name}</span>
				{/if}
			{/snippet}

			{#snippet badge(item: { id: string })}
				{@const svc = byId(item.id)}
				{#if svc}
					<StatusBadge status={statusOf(svc)} />
				{/if}
			{/snippet}

			{#snippet details(item: { id: string })}
				<PreviewRows
					class="ml-4 sm:ml-11"
					previews={byId(item.id)?.previews ?? []}
				/>
			{/snippet}

			{#snippet actions(item: { id: string })}
				{@const svc = byId(item.id)}
				{#if svc}
					<ServiceRowActions
						{deleteVolumes}
						ondelete={(e) => requestDelete(e, svc.name)}
						pending={pending[svc.id] ?? false}
						service={svc}
						submit={(action) => withPending(svc.id, action)}
					/>
				{/if}
			{/snippet}

			<div class="space-y-6">
				{#each groups as { depth, key, label, services } (key)}
					<div
						class={depth > 0 ? "border-border border-l pl-4" : ""}
						style:margin-left="{depth * 1.25}rem"
					>
						{#if groups.length > 1}
							<h2 class="eyebrow mb-2 flex items-center gap-1.5">
								{#if depth > 0}
									<CornerDownRight class="text-text-subtle size-3.5" />
								{/if}
								{label}
							</h2>
						{/if}
						{#if services.length > 0}
							<EntityList
								{actions}
								{details}
								{wrapper}
								items={services.map((svc) => ({
									description: `${svc.image}:${svc.tag}`,
									href: `${resolve("services")}/${svc.id}`,
									id: svc.id,
									subtitle:
										primaryHostname(
											svc,
											data.stacks.find((stack) => stack.id === svc.stackId)
												?.slug,
											serviceDomain,
										) ?? svc.slug,
									title: svc.name,
								}))}
								onToggleSelect={(id) => selection.toggle(id)}
								{badge}
								{media}
								selectedIds={selection.ids}
								view={cardView}
							/>
						{/if}
					</div>
				{/each}
			</div>

			<Pagination label="services" {page} {perPage} total={data.total} />
		{/if}
	{/if}
</div>

{#snippet viewSwitch()}
	<nav
		class="border-border inline-flex rounded-lg border p-0.5"
		aria-label="Services view"
	>
		{#each VIEWS as option (option.id)}
			{@const Icon = option.icon}
			<a
				class="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors {mode ===
				option.id
					? 'bg-accent-light text-accent'
					: 'text-text-muted hover:text-text'}"
				aria-current={mode === option.id ? "page" : undefined}
				href="{resolve('services')}?view={option.id}"
			>
				<Icon class="size-3.5" />
				{option.label}
			</a>
		{/each}
	</nav>
{/snippet}

{#snippet treeWrapper(svc: GraphServiceInfo, body: Snippet)}
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

<BulkBar {selection} />

<ConfirmDialog
	bind:open={deleteDialogOpen}
	confirmLabel="Delete"
	confirmPhrase={pendingDeleteName}
	description={`Delete "${pendingDeleteName}"? This removes its container and can't be undone.`}
	onConfirm={() => pendingDeleteForm?.requestSubmit()}
	title="Delete service"
>
	<DeleteVolumesOption bind:checked={deleteVolumes} />
</ConfirmDialog>

<ServiceMenuHost
	bind:this={menuHost}
	services={data.services}
	stacks={data.stacks}
/>
