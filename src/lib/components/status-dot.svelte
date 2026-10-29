<script lang="ts">
	import { SERVICE_STATUS_CONFIG } from "#lib/constants.js";
	import type { ContainerStatus } from "#lib/types.js";

	const { status }: { status: ContainerStatus } = $props();

	const meta = $derived(
		SERVICE_STATUS_CONFIG[status] ?? SERVICE_STATUS_CONFIG.pending,
	);
	const busy = $derived(status === "pulling" || status === "starting");
</script>

<span class="relative inline-flex size-2 shrink-0" title={meta.label}>
	{#if busy}
		<span
			class="absolute inset-0 animate-ping rounded-full opacity-60 {meta.dot}"
		></span>
	{/if}
	<span class="relative size-2 rounded-full {meta.dot}"></span>
	<span class="sr-only">{meta.label}</span>
</span>
