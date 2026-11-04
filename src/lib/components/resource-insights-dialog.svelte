<script lang="ts">
	import { resolve } from "$app/paths";
	import { RefreshCw } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

	import ResponsiveDialog from "#lib/components/responsive-dialog.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { getResourceInsight } from "#lib/remote/system-stats.remote.js";
	import type {
		InsightResource,
		ResourceConsumer,
	} from "#lib/services/resource-insights.service.js";

	interface Props {
		open: boolean;
		resource: InsightResource;
	}

	let { open = $bindable(false), resource }: Props = $props();

	const TITLES: Record<InsightResource, string> = {
		cpu: "What's using the CPU",
		disk: "What's using the disk",
		memory: "What's using the memory",
	};

	const DESCRIPTIONS: Record<InsightResource, string> = {
		cpu: "Every running container's share of all cores right now, named after the service, workstation or cron job it runs for.",
		disk: "What Docker keeps on this disk, its biggest volumes one by one, and the rest of the disk.",
		memory:
			"Every running container's memory right now, without the page cache the kernel can reclaim, the way docker stats counts it.",
	};

	let refreshing = $state(false);

	function href(link: NonNullable<ResourceConsumer["link"]>): string {
		if (link.kind === "service") {
			return resolve("/(protected)/services/[serviceId]", {
				serviceId: link.id,
			});
		}
		if (link.kind === "workstation") {
			return resolve("/(protected)/workstations/[workstationId]", {
				workstationId: link.id,
			});
		}
		return resolve("/(protected)/cron-jobs/[cronJobId]", {
			cronJobId: link.id,
		});
	}

	async function refresh() {
		refreshing = true;
		await getResourceInsight(resource)
			.refresh()
			.finally(() => {
				refreshing = false;
			});
	}
</script>

<ResponsiveDialog
	description={DESCRIPTIONS[resource]}
	size="lg"
	title={TITLES[resource]}
	bind:open
>
	{#if open}
		{@const insight = getResourceInsight(resource)}
		{#if insight.error}
			<p class="text-sm text-red-600 dark:text-red-400">
				Couldn't read what's using it right now. The worker may be busy, try
				again in a moment.
			</p>
		{:else if !insight.current}
			<div class="space-y-2">
				<Skeleton class="h-9 rounded-md" />
				<Skeleton class="h-9 rounded-md" />
				<Skeleton class="h-9 rounded-md" />
			</div>
		{:else}
			<div class="mb-3 flex items-center justify-between gap-3">
				<p class="text-text-muted text-sm">
					The host is at <b class="text-text"
						>{insight.current.percent.toFixed(0)}%</b
					>.
				</p>
				<Button
					disabled={refreshing}
					onclick={refresh}
					size="sm"
					variant="outline"
				>
					<RefreshCw class="size-4 {refreshing ? 'animate-spin' : ''}" />Refresh
				</Button>
			</div>
			{#if insight.current.consumers.length === 0}
				<p class="text-text-muted text-sm">Nothing measurable uses it.</p>
			{:else}
				<ul class="divide-border border-border divide-y rounded-md border">
					{#each insight.current.consumers as consumer, index (index)}
						<li class="px-3 py-2">
							<div class="flex items-baseline justify-between gap-3">
								<span class="min-w-0 truncate text-sm">
									{#if consumer.link}
										<a
											class="text-text font-medium hover:underline"
											href={href(consumer.link)}
											onclick={() => (open = false)}>{consumer.label}</a
										>
									{:else}
										<span class="text-text font-medium">{consumer.label}</span>
									{/if}
									<span class="text-text-subtle ml-1.5 text-xs"
										>{consumer.kind}</span
									>
								</span>
								<span class="text-text shrink-0 text-sm tabular-nums"
									>{consumer.amount}</span
								>
							</div>
							<span
								class="bg-surface-2 mt-1.5 block h-1 overflow-hidden rounded-full"
							>
								<span
									class="bg-accent block h-full"
									style="width: {Math.min(100, consumer.share)}%"
								></span>
							</span>
							{#if consumer.detail}
								<p class="text-text-subtle mt-1 truncate text-xs">
									{consumer.detail}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</ResponsiveDialog>
