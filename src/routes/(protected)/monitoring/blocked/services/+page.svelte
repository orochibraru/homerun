<script lang="ts">
	import { resolve } from "$app/paths";
	import { Trophy } from "@lucide/svelte";

	import ChartHoverTarget from "#lib/components/chart-hover-target.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { formatPercent } from "#lib/metrics-format.js";

	const { data } = $props();

	const most = $derived(Math.max(1, ...data.perService.map((row) => row.bans)));
	const total = $derived(
		data.perService.reduce((sum, row) => sum + row.bans, 0),
	);
</script>

<section class="panel rounded-md">
	<PanelHeader
		description="Services ranked by how many of the addresses banned right now were caught on them. An address that hit several services counts on each."
		icon={Trophy}
		title="Bans by service"
	/>
	{#if data.perService.length === 0}
		<div class="p-5">
			<EmptyState
				icon={Trophy}
				subtitle="Once an address is banned for hitting a service's blocked paths, the service shows up here."
				title="No service has banned addresses"
			/>
		</div>
	{:else}
		<ol class="divide-border divide-y">
			{#each data.perService as row, index (row.serviceId)}
				<li class="flex items-center gap-4 px-5 py-3">
					<span
						class="text-text-subtle w-6 shrink-0 text-right text-sm font-semibold tabular-nums"
					>
						{index + 1}
					</span>
					<div class="min-w-0 flex-1">
						<a
							class="text-text hover:text-accent truncate text-sm font-medium"
							href={resolve(
								"/(protected)/services/[serviceId]/observability/blocked",
								{
									serviceId: row.serviceId,
								},
							)}
						>
							{row.serviceName}
						</a>
						<ChartHoverTarget
							class="mt-0.5 rounded-full py-1"
							label="{row.serviceName}: {row.bans} banned addresses"
						>
							{#snippet tip()}
								<p class="opacity-75">{row.serviceName}</p>
								<p>
									<b class="text-sm font-bold">{row.bans.toLocaleString()}</b>
									banned {row.bans === 1 ? "address" : "addresses"}
								</p>
								<p class="opacity-75">
									{formatPercent(row.bans, total, 0)} of all bans · #{index + 1}
								</p>
							{/snippet}
							<span
								class="bg-surface-2 block h-1.5 overflow-hidden rounded-full"
							>
								<span
									class="bg-accent block h-full rounded-full"
									style="width: {(row.bans / most) * 100}%"
								></span>
							</span>
						</ChartHoverTarget>
					</div>
					<span class="text-text shrink-0 text-sm font-semibold tabular-nums">
						{row.bans.toLocaleString()}
					</span>
				</li>
			{/each}
		</ol>
	{/if}
</section>
