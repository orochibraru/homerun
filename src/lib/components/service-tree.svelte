<script lang="ts">
	import { resolve } from "$app/paths";
	import { Bird, GitPullRequest, Layers, Server } from "@lucide/svelte";
	import type { Snippet } from "svelte";

	import StatusDot from "#lib/components/status-dot.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import type {
		DependencyNode,
		GraphServiceInfo,
		PreviewRow,
	} from "#lib/service-graph.js";
	import type { ContainerStatus } from "#lib/types.js";

	interface Props {
		/** Indents every row, for a substack drawn under its parent. */
		depth?: number;
		/** Stacks shown on this page: a dependency in any other one is drawn as a reference to it. Unset, nothing is. */
		localStackIds?: Set<string>;
		nodes: DependencyNode[];
		/** Pull request previews by parent id, drawn under their parent's row. */
		previews?: Map<string, PreviewRow[]>;
		services: Map<string, GraphServiceInfo>;
		stackNames: Map<string, string>;
		/** The services depending on each one, named on a row reached from more than one. */
		usedBy?: Map<string, string[]>;
		/** Wraps each row, for the service context menu. */
		wrapper?: Snippet<[GraphServiceInfo, Snippet]>;
	}

	const {
		depth = 0,
		localStackIds,
		nodes,
		previews,
		services,
		stackNames,
		usedBy,
		wrapper,
	}: Props = $props();

	type Row = { last: boolean; level: number; rails: boolean[] } & (
		| { kind: "preview"; preview: PreviewRow }
		| { kind: "ref"; outside: boolean; svc: GraphServiceInfo }
		| { kind: "service"; svc: GraphServiceInfo }
	);

	/**
	 * Flattens the forest into rows, each carrying the guide lines drawn left
	 * of it: one rail per ancestor still followed by a sibling, then an elbow.
	 */
	function flatten(forest: DependencyNode[]): Row[] {
		const rows: Row[] = [];
		const walk = (list: DependencyNode[], level: number, rails: boolean[]) => {
			list.forEach((node, i) => {
				const svc = services.get(node.id);
				if (!svc) {
					return;
				}
				const last = i === list.length - 1;
				const outside =
					localStackIds !== undefined &&
					!(svc.stackId && localStackIds.has(svc.stackId));
				if (node.repeat || outside) {
					rows.push({ kind: "ref", last, level, outside, rails, svc });
					return;
				}
				rows.push({ kind: "service", last, level, rails, svc });
				const childRails = level === 0 ? [] : [...rails, !last];
				const kids = previews?.get(node.id) ?? [];
				kids.forEach((preview, j) =>
					rows.push({
						kind: "preview",
						last: j === kids.length - 1 && node.children.length === 0,
						level: level + 1,
						preview,
						rails: childRails,
					}),
				);
				walk(node.children, level + 1, childRails);
			});
		};
		walk(forest, 0, []);
		return rows;
	}

	const rows = $derived(flatten(nodes));

	/** Splits an image reference into its repository's last segment and its tag. */
	function imageParts(image: string): { name: string; tag: string } {
		const at = image.lastIndexOf(":");
		const ref = at > image.lastIndexOf("/") ? image.slice(0, at) : image;
		const tag = at > image.lastIndexOf("/") ? image.slice(at + 1) : "latest";
		return { name: ref.split("/").pop() ?? ref, tag };
	}
</script>

{#snippet guides(row: Row)}
	{#each row.rails as rail, i (i)}
		<span class="relative w-5 shrink-0 self-stretch">
			{#if rail}
				<span class="border-border absolute inset-y-0 left-2 border-l"></span>
			{/if}
		</span>
	{/each}
	{#if row.level > 0}
		<span class="relative w-5 shrink-0 self-stretch">
			<span
				class="border-border absolute top-0 left-2 h-1/2 w-2.5 rounded-bl-md border-b border-l"
			></span>
			{#if !row.last}
				<span class="border-border absolute top-1/2 bottom-0 left-2 border-l"
				></span>
			{/if}
		</span>
	{/if}
{/snippet}

<ul class="divide-border/50 divide-y" style:--depth={depth}>
	{#each rows as row, i (i)}
		<li>
			{#if row.kind === "service"}
				{@const svc = row.svc}
				{@const image = imageParts(svc.image)}
				{@const dependents = usedBy?.get(svc.id) ?? []}
				{#snippet line()}
					<a
						class="hover:bg-surface-2 focus-visible:bg-surface-2 flex h-11 items-center gap-2.5 pr-4 pl-[calc(1rem+var(--depth)*1.25rem)] transition-colors outline-none"
						href={`${resolve("services")}/${svc.id}`}
					>
						{@render guides(row)}
						<StatusDot status={svc.currentStatus as ContainerStatus} />
						<TemplateIcon
							category={svc.category}
							class="size-6 shrink-0 rounded-md"
							fallback={Server}
							icon={svc.icon}
						/>
						<span class="text-text min-w-0 truncate text-sm font-medium"
							>{svc.name}</span
						>
						<span
							class="text-text-subtle hidden min-w-0 truncate font-mono text-[0.6875rem] sm:inline"
							>{svc.slug}</span
						>
						<span class="flex-1"></span>
						{#if dependents.length > 1}
							<span
								class="text-text-subtle hidden shrink-0 text-[0.6875rem] lg:inline"
							>
								used by {dependents.join(", ")}
							</span>
						{/if}
						<span
							class="text-text-subtle hidden max-w-80 min-w-0 shrink-0 items-center justify-end gap-1.5 font-mono text-[0.6875rem] md:flex"
							title={svc.image}
						>
							<span class="truncate">{image.name}</span>
							<span
								class="bg-accent-light text-accent shrink-0 rounded px-1.5 py-px"
								>{image.tag}</span
							>
						</span>
					</a>
				{/snippet}
				{#if wrapper}
					{@render wrapper(svc, line)}
				{:else}
					{@render line()}
				{/if}
			{:else if row.kind === "ref"}
				{@const svc = row.svc}
				<div
					class="text-text-subtle flex h-8 items-center gap-2 pr-4 pl-[calc(1rem+var(--depth)*1.25rem)] text-xs"
				>
					{@render guides(row)}
					<span>uses</span>
					<a
						class="bg-surface hover:border-accent/40 text-text inline-flex min-w-0 items-center gap-1.5 rounded-md border py-0.5 pr-2 pl-1 transition-colors {row.outside
							? 'border-border border-dashed'
							: 'border-border'}"
						href={`${resolve("services")}/${svc.id}`}
					>
						<TemplateIcon
							category={svc.category}
							class="size-4 shrink-0 rounded"
							fallback={Server}
							icon={svc.icon}
						/>
						<span class="truncate">{svc.name}</span>
						{#if row.outside}
							<span class="text-text-subtle shrink-0">
								· {svc.stackId
									? (stackNames.get(svc.stackId) ?? "another stack")
									: "no stack"}
							</span>
						{/if}
						<StatusDot status={svc.currentStatus as ContainerStatus} />
					</a>
				</div>
			{:else}
				{@const preview = row.preview}
				<a
					class="hover:bg-surface-2 text-text-muted flex h-8 items-center gap-2 pr-4 pl-[calc(1rem+var(--depth)*1.25rem)] text-xs transition-colors"
					href={resolve("/(protected)/services/[serviceId]", {
						serviceId: preview.id,
					})}
				>
					{@render guides(row)}
					<StatusDot status={preview.currentStatus as ContainerStatus} />
					{#if preview.kind === "canary"}
						<Bird class="text-text-subtle size-3.5 shrink-0" />
						<span class="text-text shrink-0 font-medium">Canary</span>
						<span class="min-w-0 truncate">{preview.name}</span>
					{:else if preview.kind === "environment"}
						<Layers class="text-text-subtle size-3.5 shrink-0" />
						<span class="text-text shrink-0 font-medium"
							>{preview.environment}</span
						>
						<span class="min-w-0 truncate">{preview.name}</span>
					{:else}
						<GitPullRequest class="text-text-subtle size-3.5 shrink-0" />
						<span class="text-text shrink-0 font-medium"
							>#{preview.prNumber}</span
						>
						<span class="min-w-0 truncate">
							{preview.title ?? preview.branch ?? preview.name}
						</span>
					{/if}
				</a>
			{/if}
		</li>
	{/each}
</ul>
