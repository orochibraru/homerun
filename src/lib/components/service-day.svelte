<script lang="ts">
	import { resolve } from "$app/paths";
	import { ArrowRight } from "@lucide/svelte";

	import LaneStrip from "#lib/components/lane-strip.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { LANE_SPAN_MS } from "#lib/lanes.js";
	import {
		formatCount as count,
		formatMs as ms,
		formatPercent as percent,
	} from "#lib/metrics-format.js";
	import { getLanes } from "#lib/remote/lanes.remote.js";

	interface Props {
		serviceId: string;
		/** Draws a dashed line instead of traffic. */
		stopped?: boolean;
	}

	const { serviceId, stopped = false }: Props = $props();

	const lanes = $derived(getLanes([serviceId]));
	const lane = $derived(lanes.current?.[serviceId] ?? null);
	const requests = $derived(lane?.requests.reduce((a, b) => a + b, 0) ?? 0);
	const errors = $derived(lane?.errors.reduce((a, b) => a + b, 0) ?? 0);

	const ticks = $derived.by(() => {
		const end = Date.now();
		return Array.from({ length: 5 }, (_, i) => {
			const at = new Date(end - LANE_SPAN_MS + (i * LANE_SPAN_MS) / 4);
			return i === 4
				? "now"
				: at.toLocaleTimeString(undefined, {
						hour: "2-digit",
						minute: "2-digit",
					});
		});
	});

	const stats = $derived([
		{ label: "requests", value: count(requests) },
		{ label: "avg response", value: ms(lane?.avgResponseMs ?? null) },
		{ label: "errors", value: percent(errors, requests) },
		{ label: "deploys", value: String(lane?.deploys.length ?? 0) },
	]);
</script>

<section class="space-y-3">
	<header class="flex items-baseline gap-2">
		<h2 class="text-text text-sm font-semibold">Last 24 hours</h2>
		<a
			class="text-accent ml-auto inline-flex items-center gap-1 text-xs font-medium hover:underline"
			href={resolve("/(protected)/services/[serviceId]/observability", {
				serviceId,
			})}
		>
			Observability <ArrowRight class="size-3" />
		</a>
	</header>
	{#if !lanes.current && !lanes.error}
		<Skeleton class="h-24 w-full" />
	{:else if lanes.error}
		<p class="text-text-muted text-sm">Couldn't load the last 24 hours.</p>
	{:else}
		<dl class="flex flex-wrap gap-x-8 gap-y-2">
			{#each stats as stat (stat.label)}
				<div>
					<dd class="text-text font-mono text-lg font-medium tabular-nums">
						{stat.value}
					</dd>
					<dt class="text-text-muted text-xs">{stat.label}</dt>
				</div>
			{/each}
		</dl>
		<LaneStrip class="h-10" {lane} {stopped} />
		<div
			class="text-text-subtle flex justify-between font-mono text-[0.6875rem] tabular-nums"
		>
			{#each ticks as tick, i (i)}
				<span>{tick}</span>
			{/each}
		</div>
	{/if}
</section>
