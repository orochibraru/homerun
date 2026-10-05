<script lang="ts">
	import { onMount } from "svelte";
	import MonitoringView from "#lib/components/monitoring/monitoring-view.svelte";
	import ServiceBreakdownTable from "#lib/components/monitoring/service-breakdown.svelte";
	import { title } from "#lib/store/title.js";

	const { data } = $props();

	onMount(() => title.set("Monitoring"));
</script>

<div class="space-y-5">
  <MonitoringView
    monitoring={data.monitoring}
    resourceSubject="host"
    zone={data.zone}
  />
  <ServiceBreakdownTable rows={data.breakdown} />
</div>
