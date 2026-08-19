<script lang="ts">
  import { SERVICE_STATUS_CONFIG } from "$lib/constants";
  import type { ContainerStatus } from "$lib/types";

  const { status }: { status: ContainerStatus } = $props();

  const meta = $derived(SERVICE_STATUS_CONFIG[status]);
</script>

<span
  class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold {meta.class}"
>
  {#if status === "pulling" || status === "starting"}
    <meta.icon class="size-3 animate-spin" />
  {:else}
    <meta.icon class="size-3" />
  {/if}
  {meta.label}
</span>
