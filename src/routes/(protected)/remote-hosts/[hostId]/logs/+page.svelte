<script lang="ts">
	import { refreshAll } from "$app/navigation";
	import { FileText, RefreshCw } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import { onMount } from "svelte";

	import DeployLogPanel from "#lib/components/deploy-log-panel.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { title } from "#lib/store/title.js";

	const { data } = $props();

	onMount(() => title.set(`${data.host.name} · Logs`));

	let refreshing = $state(false);
	const log = $derived(
		data.lines
			.map((entry) => `${new Date(entry.time).toLocaleString()}  ${entry.line}`)
			.join("\n"),
	);

	async function refresh() {
		refreshing = true;
		await refreshAll().finally(() => {
			refreshing = false;
		});
	}
</script>

<section class="panel flex h-[40rem] flex-col rounded-md">
	<PanelHeader
		description="What the agent logged since it last started, its last 2000 lines: requests, builds, workstations."
		title="Agent log"
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
	{:else if data.lines.length === 0}
		<div class="p-5">
			<EmptyState icon={FileText} title="Nothing logged yet" />
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col pt-3">
			<DeployLogPanel errorMessage={null} fill {log} logName="agent log" />
		</div>
	{/if}
</section>
