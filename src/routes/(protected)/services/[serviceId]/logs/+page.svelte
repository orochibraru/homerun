<script lang="ts">
	import { onMount } from "svelte";
	import LiveLogViewer from "$lib/components/live-log-viewer.svelte";
	import { title } from "$lib/store/title";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Logs`));
</script>

<LiveLogViewer containerId={svc.containerId} serviceId={svc.id} />
