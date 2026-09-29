<script lang="ts">
	import { onMount } from "svelte";
	import MonitoringView from "$lib/components/monitoring/monitoring-view.svelte";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Monitoring`));
</script>

<MonitoringView
  monitoring={data.monitoring}
  trafficEmpty={data.service.dnsResolvable
    ? undefined
    : "This service isn't publicly routed, so Traefik sees no requests for it."}
  zone={data.zone}
/>
