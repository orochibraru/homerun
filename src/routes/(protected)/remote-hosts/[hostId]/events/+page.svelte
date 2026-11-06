<script lang="ts">
	import { refreshAll } from "$app/navigation";
	import { History, RefreshCw } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { onMount } from "svelte";

	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";

	const { data } = $props();

	onMount(() => title.set(`${data.host.name} · Events`));

	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		await refreshAll().finally(() => {
			refreshing = false;
		});
	}

	function failed(action: string, exitCode: string | undefined): boolean {
		return (
			action === "oom" ||
			action === "kill" ||
			(action === "die" && !!exitCode && exitCode !== "0")
		);
	}
</script>

<section class="panel rounded-md">
	<PanelHeader
		description="The host's Docker events of the last day, newest first, as far back as its daemon still holds them."
		title="Docker events"
	>
		{#snippet trailing()}
			<Button
				disabled={refreshing}
				onclick={refresh}
				size="sm"
				variant="outline"
			>
				<RefreshCw class="size-4 {refreshing ? 'animate-spin' : ''}" />Refresh
			</Button>
		{/snippet}
	</PanelHeader>
	{#if data.error}
		<p class="p-5 text-sm text-red-600 dark:text-red-400">{data.error}</p>
	{:else if data.events.length === 0}
		<div class="p-5">
			<EmptyState icon={History} title="No events in the last day" />
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="bg-surface-2 text-text-muted text-left text-xs">
					<tr>
						<th class="px-4 py-2 font-medium">When</th>
						<th class="px-4 py-2 font-medium">Type</th>
						<th class="px-4 py-2 font-medium">Action</th>
						<th class="px-4 py-2 font-medium">Object</th>
						<th class="px-4 py-2 font-medium">Image</th>
					</tr>
				</thead>
				<tbody>
					{#each data.events as event, index (index)}
						<tr class="border-border border-t">
							<td
								class="text-text-muted px-4 py-2 whitespace-nowrap"
								title={new Date(event.time).toLocaleString()}
							>
								{timeAgo(new Date(event.time))}
							</td>
							<td class="text-text-muted px-4 py-2">{event.type}</td>
							<td
								class="px-4 py-2 {failed(event.action, event.exitCode)
									? 'text-red-600 dark:text-red-400'
									: 'text-text'}"
							>
								{event.action}{event.exitCode
									? ` (exit ${event.exitCode})`
									: ""}
							</td>
							<td class="text-text px-4 py-2 font-mono text-xs">
								{event.name ?? event.id.slice(0, 12)}
							</td>
							<td class="text-text-muted px-4 py-2 font-mono text-xs">
								{event.image ?? ""}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
