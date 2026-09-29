<script lang="ts">
	import { HardDrive } from "@lucide/svelte";
	import { formatBytes } from "$lib/formatting";
	import type { VolumeSizeRow } from "$lib/remote/volume-sizes.remote";

	interface Props {
		/** Undefined while the size is still being measured. */
		size: VolumeSizeRow | undefined;
	}

	const { size }: Props = $props();
</script>

<span
  class="text-text-muted flex items-center gap-1 text-xs tabular-nums"
  title={size?.error ?? "Measured on disk with du, refreshed every ten minutes"}
>
  <HardDrive class="size-3" />
  {#if size === undefined}
    <span class="text-text-subtle">measuring…</span>
  {:else if size.bytes === null}
    <span class="text-text-subtle">size unknown</span>
  {:else}
    {formatBytes(size.bytes)}
  {/if}
</span>
