<script lang="ts">
	import { SERVICE_STATUS_CONFIG } from "$lib/constants";
	import type { ContainerStatus } from "$lib/types";

	const { status }: { status: ContainerStatus } = $props();

	const meta = $derived(SERVICE_STATUS_CONFIG[status]);
</script>

<span
  class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase {meta.class}"
>
  {#if status === "pulling" || status === "starting"}
    <meta.icon class="size-2.5 animate-spin" />
  {:else}
    <meta.icon class="size-2.5" />
  {/if}
  {meta.label}
</span>
