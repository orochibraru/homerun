<script lang="ts">
	import { resolve } from "$app/paths";
	import { History } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { onMount } from "svelte";

	import LiveLogViewer from "#lib/components/live-log-viewer.svelte";
	import { title } from "#lib/store/title.js";

	const { data } = $props();
	const ws = $derived(data.workstation);

	onMount(() => title.set(`${ws.name} · Logs`));
</script>

<div class="space-y-3">
	<div class="flex justify-end">
		<Button
			href={resolve("/(protected)/workstations/[workstationId]/logs/history", {
				workstationId: ws.id,
			})}
			size="sm"
			variant="outline"
		>
			<History class="size-3.5" />
			Log history
		</Button>
	</div>
	<LiveLogViewer
		heightClass="h-[36rem]"
		logsUrl={resolve("/(protected)/workstations/[workstationId]/logs/stream", {
			workstationId: ws.id,
		})}
		serviceId={ws.id}
		workloadId={ws.id}
	/>
	<p class="text-text-subtle text-xs">
		What the IDE container prints, the last 500 lines then live. Log history
		keeps what earlier containers printed. A failed image pull or clone happens
		before the container runs: its error is on the Overview tab.
	</p>
</div>
