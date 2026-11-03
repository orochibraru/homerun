<script lang="ts">
	import { onMount } from "svelte";

	import { title } from "#lib/store/title.js";
	import { visibleIn } from "#lib/ui-mode.js";

	import ExposedPortsSection from "./exposed-ports-section.svelte";
	import PublishedPortsSection from "./published-ports-section.svelte";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Ports`));

	const published = $derived(
		visibleIn(data.uiMode, "service/networking#published-ports") ||
			svc.publishedPorts.length > 0,
	);
	const exposed = $derived(
		visibleIn(data.uiMode, "service/networking#exposed-ports") ||
			svc.exposedPorts.length > 0,
	);
</script>

<div class="space-y-6">
	{#if published || !exposed}
		<PublishedPortsSection {svc} />
	{/if}
	{#if exposed || !published}
		<ExposedPortsSection {svc} />
	{/if}
</div>
