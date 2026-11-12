<script lang="ts" module>
	import type { GraphServiceInfo } from "#lib/service-graph.js";
	import type { RevisionHealth } from "#lib/types.js";

	export type TableService = GraphServiceInfo & {
		domain: string | null;
		swarmServiceId: string | null;
	};

	export interface TableRow {
		last: boolean;
		level: number;
		rails: boolean[];
		service: TableService;
	}

	export interface ServiceHealth {
		health: RevisionHealth | null;
		reason: string | null;
	}

	export interface TableGroup {
		depth: number;
		key: string;
		label: string;
		rows: TableRow[];
	}
</script>

<script lang="ts">
	import { resolve } from "$app/paths";
	import { Layers, Server } from "@lucide/svelte";
	import { Checkbox } from "@zedensix/ui/checkbox";
	import type { Snippet } from "svelte";

	import { clockLabel } from "#lib/chart-hover.js";
	import ChartHoverTarget from "#lib/components/chart-hover-target.svelte";
	import PreviewRows from "#lib/components/preview-rows.svelte";
	import RingGauge from "#lib/components/ring-gauge.svelte";
	import Sparkline from "#lib/components/sparkline.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import { formatBytes } from "#lib/formatting.js";
	import { type Lane, laneBucketRange } from "#lib/lanes.js";
	import type { ListSelection } from "#lib/list-selection.svelte.js";
	import { formatCount, formatPercent } from "#lib/metrics-format.js";
	import type { ServiceUsage } from "#lib/remote/stats.remote.js";
	import type { PreviewRow } from "#lib/service-graph.js";
	import { hasIconImage } from "#lib/service-icon.js";
	import type { ContainerStatus } from "#lib/types.js";

	interface Props {
		actions: Snippet<[TableService]>;
		groups: TableGroup[];
		health: (svc: TableService) => ServiceHealth;
		lanes: Record<string, Lane> | null;
		previews: Map<string, PreviewRow[]>;
		selection: ListSelection;
		showGroups: boolean;
		status: (svc: TableService) => ContainerStatus;
		usage: Map<string, ServiceUsage>;
		wrapper: Snippet<[TableService, Snippet]>;
	}

	const {
		actions,
		groups,
		health,
		lanes,
		previews,
		selection,
		showGroups,
		status,
		usage,
		wrapper,
	}: Props = $props();

	const GRID =
		"grid grid-cols-[1.125rem_minmax(0,1fr)_auto_1.75rem] items-center gap-3.5 px-4 sm:grid-cols-[1.125rem_minmax(0,1fr)_7.5rem_auto_1.75rem] md:px-5.5 lg:grid-cols-[1.125rem_minmax(0,1.5fr)_minmax(0,1.3fr)_7.5rem_7.5rem_7.5rem_1.75rem] xl:grid-cols-[1.125rem_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_9.375rem_7.5rem_7.5rem_1.75rem]";

	/** Splits an image reference into its repository's last segment and its tag. */
	function imageParts(image: string): { name: string; tag: string } {
		const at = image.lastIndexOf(":");
		const tagged = at > image.lastIndexOf("/");
		const ref = tagged ? image.slice(0, at) : image;
		return {
			name: ref.split("/").pop() ?? ref,
			tag: tagged ? image.slice(at + 1) : "latest",
		};
	}

	/** A stable hue for a service's letter tile, from its slug. */
	function hueOf(slug: string): number {
		let hash = 0;
		for (const char of slug) {
			hash = (hash * 31 + char.charCodeAt(0)) % 360;
		}
		return hash;
	}

	/** A lane's half-hour counts summed into hours, so the sparkline reads as a trend rather than noise. */
	function hourly(counts: number[]): number[] {
		return counts.flatMap((value, i, all) =>
			i % 2 === 0 ? [value + (all[i + 1] ?? 0)] : [],
		);
	}

	/** Whether a quarter or more of a lane's requests errored. */
	function erroring(lane: Lane): boolean {
		const requests = lane.requests.reduce((sum, n) => sum + n, 0);
		const errors = lane.errors.reduce((sum, n) => sum + n, 0);
		return requests > 0 && errors / requests >= 0.25;
	}

	const STATUS_DETAIL: Record<ContainerStatus, string> = {
		failed: "The container exited or keeps crashing. Its logs say why.",
		missing:
			"The container is gone from the host, likely removed outside Homerun.",
		pending: "Not deployed yet.",
		pulling: "Pulling the image for a deploy.",
		running: "Up. No health check result for this revision.",
		starting: "The container is starting.",
		stopped: "Stopped. Start it to bring it back.",
	};

	const HEALTH_DETAIL: Record<RevisionHealth, string> = {
		healthy: "Up and passing its health check.",
		rolled_back: "This revision failed its health check and was rolled back.",
		unhealthy: "Up, but failing its health check.",
		watching: "Up. The health check is still watching this revision.",
	};

	/** What the status badge's tooltip says about a service's state. */
	function statusDetail(
		current: ContainerStatus,
		check: ServiceHealth,
	): string {
		return current === "running" && check.health
			? HEALTH_DETAIL[check.health]
			: STATUS_DETAIL[current];
	}

	function runningIn(group: TableGroup): number {
		return group.rows.filter((row) => status(row.service) === "running").length;
	}
</script>

<div class="panel overflow-hidden rounded-2xl py-1.5">
	<div
		class="{GRID} border-border text-text-subtle h-9 border-b text-xs font-semibold"
	>
		<Checkbox
			aria-label="Select all services"
			checked={selection.allVisible}
			indeterminate={selection.count > 0 && !selection.allVisible}
			onCheckedChange={() => selection.toggleAllVisible()}
		/>
		<span>Service</span>
		<span class="max-lg:hidden">Domain</span>
		<span class="max-xl:hidden">Image</span>
		<span class="max-sm:hidden">Requests · 24h</span>
		<span class="max-lg:hidden">CPU · Memory</span>
		<span>Status</span>
		<span></span>
	</div>

	{#each groups as group, g (group.key)}
		{#if showGroups}
			<div
				class="border-border bg-surface-2 text-text-muted flex h-10 items-center gap-2 border-b px-4 text-xs font-bold md:px-5.5 {g >
				0
					? 'border-t'
					: ''}"
			>
				<span style:padding-left="{group.depth * 1.25}rem"></span>
				<Layers class="size-3.5" />
				{group.label}
				<small class="text-text-subtle font-semibold">{group.rows.length}</small
				>
				<span class="text-text-subtle ml-auto font-semibold">
					{runningIn(group)} running
				</span>
			</div>
		{/if}
		{#each group.rows as row, i (`${group.key}:${row.service.id}`)}
			{@const svc = row.service}
			{@const image = imageParts(svc.image)}
			{@const lane = lanes?.[svc.id]}
			{@const sample = usage.get(svc.id)}
			{@const current = status(svc)}
			{@const check = health(svc)}
			{@const kids = previews.get(svc.id) ?? []}
			{#snippet body()}
				<div
					class="{GRID} hover:bg-surface-2 relative h-13.5 text-sm transition-colors {i >
					0
						? 'border-border border-t'
						: ''} {selection.has(svc.id) ? 'bg-surface-2' : ''}"
					data-service-row={svc.id}
				>
					<Checkbox
						class="relative z-10"
						aria-label="Select {svc.name}"
						checked={selection.has(svc.id)}
						onCheckedChange={() => selection.toggle(svc.id)}
					/>

					<div class="flex min-w-0 items-center gap-2.5 self-stretch">
						{#each row.rails as rail, r (r)}
							<span class="relative w-4 shrink-0 self-stretch">
								{#if rail}
									<span
										class="border-border-light absolute inset-y-0 left-1 border-l-[1.5px]"
									></span>
								{/if}
							</span>
						{/each}
						{#if row.level > 0}
							<span class="relative w-4 shrink-0 self-stretch">
								<span
									class="border-border-light absolute -top-px left-1 h-[calc(50%+1px)] w-2.5 rounded-bl-lg border-b-[1.5px] border-l-[1.5px]"
								></span>
								{#if !row.last}
									<span
										class="border-border-light absolute top-1/2 bottom-0 left-1 border-l-[1.5px]"
									></span>
								{/if}
							</span>
						{/if}
						{#if hasIconImage(svc.icon)}
							<TemplateIcon
								category={svc.category}
								class="size-7 rounded-[9px] p-1"
								fallback={Server}
								icon={svc.icon}
							/>
						{:else}
							<span
								class="grid size-7 shrink-0 place-items-center rounded-[9px] bg-[oklch(0.62_0.1_var(--tile-hue)/0.13)] text-[11px] font-extrabold text-[oklch(0.48_0.12_var(--tile-hue))] dark:bg-[oklch(0.62_0.1_var(--tile-hue)/0.2)] dark:text-[oklch(0.8_0.12_var(--tile-hue))]"
								style:--tile-hue={hueOf(svc.slug)}
							>
								{svc.name.charAt(0).toUpperCase()}
							</span>
						{/if}
						<a
							class="min-w-0 leading-tight outline-none after:absolute after:inset-0 focus-visible:underline"
							href={`${resolve("services")}/${svc.id}`}
						>
							<span class="text-text block truncate font-bold">{svc.name}</span>
							<small class="text-text-subtle block truncate font-mono text-xs"
								>{svc.slug}</small
							>
						</a>
					</div>

					<span class="min-w-0 truncate max-lg:hidden">
						{#if svc.domain}
							<span class="text-text font-semibold">{svc.domain}</span>
						{:else}
							<span class="text-text-subtle">internal only</span>
						{/if}
					</span>

					<span
						class="text-text-muted flex min-w-0 items-center gap-1.5 font-mono text-xs max-xl:hidden"
					>
						<span class="truncate">{image.name}</span><span class="sr-only"
							>:</span
						><span
							class="bg-surface-2 text-text shrink-0 truncate rounded-full px-1.75 py-0.5 font-semibold"
							>{image.tag}</span
						>
					</span>

					<span class="max-sm:hidden">
						{#if !svc.domain}
							<span class="text-text-subtle">–</span>
						{:else if lane}
							<Sparkline
								class="relative z-10 max-w-30"
								color={erroring(lane) ? "var(--destructive)" : "var(--primary)"}
								placement={g === 0 && i === 0 ? "below" : "above"}
								values={hourly(lane.requests)}
							>
								{#snippet tip(hour)}
									{@const requests = hourly(lane.requests)[hour] ?? 0}
									{@const errors = hourly(lane.errors)[hour] ?? 0}
									<p class="opacity-75">
										{clockLabel(
											laneBucketRange(lane.start, hour * 2).from,
										)}–{clockLabel(
											laneBucketRange(lane.start, hour * 2 + 1).to,
										)}
									</p>
									<p>
										<b class="text-sm font-bold">{formatCount(requests)}</b>
										{requests === 1 ? "request" : "requests"}
									</p>
									{#if requests > 0}
										<p class="opacity-75">
											{formatPercent(errors, requests, 0)} errored
										</p>
									{/if}
								{/snippet}
							</Sparkline>
						{/if}
					</span>

					<span class="flex items-center gap-2.5 max-lg:hidden">
						{#if sample && current === "running"}
							<ChartHoverTarget
								class="relative z-10 flex w-auto items-center gap-2.5 rounded-md"
								label="CPU {sample.cpuPercent.toFixed(1)}%, memory {formatBytes(
									sample.memUsedMb * 1024 * 1024,
								)}"
								placement={g === 0 && i === 0 ? "below" : "above"}
							>
								{#snippet tip()}
									<p class="opacity-75">Latest sample</p>
									<p>
										<b class="text-sm font-bold"
											>{sample.cpuPercent.toFixed(1)}%</b
										> CPU
									</p>
									<p>{formatBytes(sample.memUsedMb * 1024 * 1024)} memory</p>
								{/snippet}
								<RingGauge percent={sample.cpuPercent} size={22} stroke={3.5} />
								<span class="leading-tight">
									<span class="text-text block font-semibold tabular-nums"
										>{Math.round(sample.cpuPercent)}%</span
									>
									<small class="text-text-subtle block text-xs"
										>{formatBytes(sample.memUsedMb * 1024 * 1024)}</small
									>
								</span>
							</ChartHoverTarget>
						{:else}
							<span class="text-text-subtle">–</span>
						{/if}
					</span>

					<span>
						<ChartHoverTarget
							class="relative z-10 w-auto rounded-full"
							label={statusDetail(current, check)}
							placement={g === 0 && i === 0 ? "below" : "above"}
						>
							{#snippet tip()}
								<p class="w-64 whitespace-normal">
									{statusDetail(current, check)}
								</p>
								{#if current === "running" && check.reason}
									<p class="mt-1 w-64 whitespace-normal opacity-75">
										{check.reason}
									</p>
								{/if}
							{/snippet}
							<StatusBadge health={check.health} status={current} />
						</ChartHoverTarget>
					</span>

					{@render actions(svc)}
				</div>
			{/snippet}
			{@render wrapper(svc, body)}
			{#if kids.length > 0}
				<div class="px-4 pb-2 md:px-5.5">
					<PreviewRows
						class="ml-[calc(1.125rem+0.875rem+2.375rem)]"
						previews={kids}
					/>
				</div>
			{/if}
		{/each}
	{/each}
</div>
