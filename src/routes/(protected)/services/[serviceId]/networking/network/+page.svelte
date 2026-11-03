<script lang="ts">
	import { onMount } from "svelte";

	import { title } from "#lib/store/title.js";
	import { visibleIn } from "#lib/ui-mode.js";

	import NetworkSection from "./network-section.svelte";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Network`));
</script>

<NetworkSection
	collapseNetworkMode={!visibleIn(
		data.uiMode,
		"service/networking#network-mode",
	) && svc.networkMode === "bridge"}
	errors={form?.errors as Record<string, string[]> | undefined}
	serviceDomain={data.serviceDomain}
	submittedValues={form?.portsValues as Record<string, string> | undefined}
	{svc}
/>
