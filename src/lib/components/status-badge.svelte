<script lang="ts">
	import { SERVICE_STATUS_CONFIG } from "$lib/constants";
	import type { ContainerStatus } from "$lib/types";

	const { status }: { status: ContainerStatus } = $props();

	const meta = $derived(SERVICE_STATUS_CONFIG[status]);
</script>

<span
  class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.65rem] font-medium tracking-wider uppercase {meta.class}"
>
  {#if status === "pulling" || status === "starting"}
    <meta.icon class="size-3 animate-spin" />
  {:else}
    <meta.icon class="size-3" />
  {/if}
  {meta.label}
</span>
