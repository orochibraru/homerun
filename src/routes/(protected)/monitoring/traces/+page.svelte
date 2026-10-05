<script lang="ts">
	import { onMount } from "svelte";
	import TraceList from "#lib/components/tracing/trace-list.svelte";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set("Monitoring · Traces"));

	function traceHref(traceId: string): string {
		return resolve("/(protected)/monitoring/traces/[traceId]", { traceId });
	}
</script>

<div class="space-y-4">
  <p class="text-text-muted text-sm">
    Every job the worker runs (deploys, builds, scans, backups, cron jobs,
    cleanups) is a trace, with a span per stage, so a failed job shows where it
    broke and how long each stage took.
  </p>
  <TraceList
    emptySubtitle="The worker records a trace for every job it runs, starting with the next one."
    emptyTitle="No traces yet"
    listing={data.listing}
    searched={data.searched}
    {traceHref}
  />
</div>
