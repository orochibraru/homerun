<script lang="ts">
	import { SERVICE_STATUS_CONFIG } from "#lib/constants.js";
	import type { ContainerStatus } from "#lib/types.js";

	const { status }: { status: ContainerStatus } = $props();

	const meta = $derived(SERVICE_STATUS_CONFIG[status]);
</script>

<span
	class="border-border-light bg-surface inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border pr-2.5 pl-2 text-xs font-bold whitespace-nowrap {meta.class}"
>
	{#if status === "pulling" || status === "starting"}
		<meta.icon class="size-3.5 animate-spin" />
	{:else}
		<meta.icon class="size-3.5" />
	{/if}
	{meta.label}
</span>
