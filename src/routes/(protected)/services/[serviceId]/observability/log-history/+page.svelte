<script lang="ts">
	import { resolve } from "$app/paths";
	import { onMount } from "svelte";

	import LogHistoryView from "#lib/components/log-history-view.svelte";
	import { title } from "#lib/store/title.js";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Log history`));
</script>

<LogHistoryView
	deployments={data.deployments}
	description="Every line this service's containers wrote, across deploys and restarts."
	downloadHref={resolve(
		"/(protected)/services/[serviceId]/observability/log-history/download",
		{ serviceId: svc.id },
	)}
	history={data.history}
	instanceLabel="Replica"
/>
