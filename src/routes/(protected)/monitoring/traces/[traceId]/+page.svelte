<script lang="ts">
	import { resolve } from "$app/paths";
	import { onMount } from "svelte";

	import TraceView from "#lib/components/tracing/trace-view.svelte";
	import { title } from "#lib/store/title.js";

	const { data } = $props();

	onMount(() => title.set("Monitoring · Trace"));
</script>

<TraceView
	backHref={resolve("/(protected)/monitoring/traces")}
	backLabel="All traces"
	spans={data.spans}
	traceId={data.traceId}
/>
