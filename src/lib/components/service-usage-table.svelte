<script lang="ts">
	import { ArrowDown, ArrowUp } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { formatBytes } from "$lib/formatting";
	import { getServiceUsage } from "$lib/remote/stats.remote";

	type SortKey = "cpu" | "memory" | "traffic" | "name";

	interface Props {
		/** Limits the table to these services; omitted means every service. */
		serviceIds?: string[];
		title?: string;
	}

	const { serviceIds, title = "Per-service usage" }: Props = $props();

	const usage = getServiceUsage();

	let sort = $state<SortKey>("cpu");
	let descending = $state(true);

	const rows = $derived.by(() => {
		const all = usage.current ?? [];
		const items = serviceIds
			? all.filter((row) => serviceIds.includes(row.id))
			: [...all];
		const value = (row: (typeof items)[number]) => {
			if (sort === "cpu") {
				return row.cpuPercent;
			}
			if (sort === "memory") {
				return row.memUsedMb;
			}
			if (sort === "traffic") {
				return row.netRxBytes + row.netTxBytes;
			}
			return 0;
		};
		items.sort((a, b) =>
			sort === "name"
				? a.name.localeCompare(b.name)
				: value(b) - value(a) || a.name.localeCompare(b.name),
		);
		return descending ? items : items.reverse();
	});

	function toggle(key: SortKey) {
		if (sort === key) {
			descending = !descending;
			return;
		}
		sort = key;
		descending = true;
	}

	const COLUMNS: [SortKey, string, string][] = [
		["name", "Service", "text-left"],
		["cpu", "CPU", "text-right"],
		["memory", "Memory", "text-right"],
		["traffic", "Traffic", "text-right"],
	];
</script>

<section class="panel rounded-xl">
  <div class="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
    <h2 class="eyebrow">{title}</h2>
    <span class="text-text-subtle text-[0.6875rem]">
      Newest sample · traffic is since each container started
    </span>
  </div>

  {#if usage.error}
    <p class="text-text-muted px-4 py-6 text-center text-xs">
      Couldn't load per-service usage.
    </p>
  {:else if !usage.ready}
    <div class="space-y-2 p-4">
      {#each [0, 1, 2] as row (row)}
        <Skeleton class="h-6 w-full" />
      {/each}
    </div>
  {:else if rows.length === 0}
    <p class="text-text-muted px-4 py-6 text-center text-xs">
      No services yet.
    </p>
  {:else}
    <table class="w-full text-left">
      <thead>
        <tr class="border-border border-b">
          {#each COLUMNS as [key, text, align] (key)}
            <th class="px-4 py-2 {align}" scope="col">
              <button
                class="text-text-muted hover:text-text inline-flex items-center gap-1 text-[0.6875rem] font-medium transition-colors"
                onclick={() => toggle(key)}
                type="button"
              >
                {text}
                {#if sort === key}
                  {#if descending}
                    <ArrowDown class="size-3" />
                  {:else}
                    <ArrowUp class="size-3" />
                  {/if}
                {/if}
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody class="divide-border divide-y">
        {#each rows as row (row.id)}
          <tr class="hover:bg-surface-2 transition-colors">
            <td class="px-4 py-2">
              <a
                class="text-text truncate text-sm hover:underline"
                href="{resolve('/services')}/{row.id}"
              >
                {row.name}
              </a>
            </td>
            <td class="tech text-text-muted px-4 py-2 text-right text-xs">
              {row.cpuPercent.toFixed(1)}%
            </td>
            <td class="tech text-text-muted px-4 py-2 text-right text-xs">
              {row.memUsedMb < 1024
              ? `${row.memUsedMb.toFixed(0)} MB`
              : `${(row.memUsedMb / 1024).toFixed(1)} GB`}
            </td>
            <td class="tech text-text-muted px-4 py-2 text-right text-xs">
              {formatBytes(row.netRxBytes + row.netTxBytes)}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
