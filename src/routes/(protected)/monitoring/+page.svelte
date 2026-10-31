<script lang="ts">
	import { onMount } from "svelte";

	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import HostResources from "#lib/components/host-resources.svelte";
	import MonitoringView from "#lib/components/monitoring/monitoring-view.svelte";
	import ServiceBreakdownTable from "#lib/components/monitoring/service-breakdown.svelte";
	import { title } from "#lib/store/title.js";

	const { data } = $props();

	onMount(() => title.set("Monitoring"));
</script>

<div class="space-y-5">
	<ErrorBoundary title="Host resources didn't load.">
		<HostResources />
	</ErrorBoundary>
	<MonitoringView
		monitoring={data.monitoring}
		resourceSubject="host"
		zone={data.zone}
	/>
	<ServiceBreakdownTable rows={data.breakdown} />
</div>
