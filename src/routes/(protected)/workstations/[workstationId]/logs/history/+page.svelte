<script lang="ts">
	import { resolve } from "$app/paths";
	import { Radio } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import { onMount } from "svelte";

	import Alert from "#lib/components/alert.svelte";
	import LogHistoryView from "#lib/components/log-history-view.svelte";
	import { title } from "#lib/store/title.js";

	const { data } = $props();
	const ws = $derived(data.workstation);

	onMount(() => title.set(`${ws.name} · Log history`));
</script>

<div class="space-y-3">
	<div class="flex justify-end">
		<Button
			href={resolve("/(protected)/workstations/[workstationId]/logs", {
				workstationId: ws.id,
			})}
			size="sm"
			variant="outline"
		>
			<Radio class="size-3.5" />
			Live logs
		</Button>
	</div>
	{#if ws.remoteHostId}
		<Alert title="Not kept for this workstation." variant="info">
			Its container runs on a remote host, and only containers on this server
			have their output kept.
		</Alert>
	{/if}
	<LogHistoryView
		description="Every line this workstation's IDE container wrote, across restarts and recreates."
		downloadHref={resolve(
			"/(protected)/workstations/[workstationId]/logs/history/download",
			{ workstationId: ws.id },
		)}
		history={data.history}
		instanceLabel="Container"
	/>
</div>
