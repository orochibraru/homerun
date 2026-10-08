<script lang="ts">
	import { ChevronRight, Globe } from "@lucide/svelte";
	import { formatBytes } from "#lib/formatting.js";
	import { objectCountLabel } from "#lib/object-storage.js";
	import { getBucketUsages } from "#lib/remote/object-storage.remote.js";
	import type { BucketRow } from "#lib/services/object-storage.service.js";
	import { resolve } from "$app/paths";

	const { rows }: { rows: BucketRow[] } = $props();

	const usages = $derived(
		getBucketUsages(
			rows.map((row) => ({ bucket: row.name, storeId: row.storeId })),
		),
	);

	function usageOf(row: BucketRow) {
		return usages.current?.find(
			(usage) => usage.storeId === row.storeId && usage.bucket === row.name,
		);
	}
</script>

<div class="panel overflow-x-auto rounded-md">
  <table class="w-full text-sm">
    <thead>
      <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
        <th class="px-4 py-3 font-medium">Bucket</th>
        <th class="px-4 py-3 font-medium">Store</th>
        <th class="hidden px-4 py-3 font-medium md:table-cell">Usage</th>
        <th class="w-8 px-4 py-3"><span class="sr-only">Open</span></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (`${row.storeId}/${row.name}`)}
        {@const usage = usageOf(row)}
        <tr class="border-border/60 hover:bg-surface-2 group relative border-b last:border-0">
          <td class="px-4 py-3">
            <a
              class="text-text group-hover:text-accent font-mono font-medium break-all after:absolute after:inset-0"
              href={resolve(
                "/(protected)/object-storage/[storeId]/buckets/[bucket]",
                { bucket: row.name, storeId: row.storeId },
              )}
            >
              {row.name}
            </a>
            {#if row.public}
              <span class="text-accent border-accent/30 ml-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium tracking-wider uppercase">
                <Globe class="size-3" />
                Public
              </span>
            {/if}
          </td>
          <td class="text-text-muted px-4 py-3">{row.storeName}</td>
          <td class="text-text-muted hidden px-4 py-3 tabular-nums md:table-cell">
            {#if !usage}
              <span class="text-text-subtle">…</span>
            {:else if usage.error !== null || usage.objects === null || usage.bytes === null}
              <span class="text-text-subtle" title={usage.error ?? ""}>Unknown</span>
            {:else}
              {objectCountLabel(usage.objects, usage.capped)} · {formatBytes(usage.bytes)}{usage.capped ? "+" : ""}
            {/if}
          </td>
          <td class="text-text-subtle px-4 py-3">
            <ChevronRight class="size-4" />
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
