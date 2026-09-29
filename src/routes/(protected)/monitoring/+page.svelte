<script lang="ts">
	import { onMount } from "svelte";
	import MonitoringView from "$lib/components/monitoring/monitoring-view.svelte";
	import ServiceBreakdownTable from "$lib/components/monitoring/service-breakdown.svelte";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Monitoring"));
</script>

<div class="p-5 md:p-6">
  <div class="mb-6">
    <h1 class="text-text text-lg font-semibold tracking-tight">Monitoring</h1>
    <p class="text-text-muted mt-1 text-sm">
      Traffic and uptime across every service, and this host's CPU and memory,
      from today back to all time.
    </p>
  </div>

  <div class="space-y-5">
    <MonitoringView
      monitoring={data.monitoring}
      resourceSubject="host"
      zone={data.zone}
    />
    <ServiceBreakdownTable rows={data.breakdown} />
  </div>
</div>
