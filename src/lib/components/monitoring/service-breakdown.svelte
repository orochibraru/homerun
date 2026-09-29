<script lang="ts">
	import { formatBytes } from "$lib/formatting";
	import {
		formatCount as count,
		formatMb as mb,
		formatMs as ms,
		formatPercent as percent,
	} from "$lib/metrics-format";
	import type { ServiceBreakdown } from "$lib/services/monitoring.service";

	interface Row extends ServiceBreakdown {
		href: string;
		name: string;
		context?: string | null;
	}

	const { rows }: { rows: Row[] } = $props();
</script>

<section class="panel rounded-md">
  <div class="panel-head">
    <h3 class="text-text text-sm font-medium">By service</h3>
    <span class="text-text-subtle text-xs">Busiest first, over the same range</span>
  </div>
  {#if rows.length === 0}
    <p class="text-text-subtle px-4 py-8 text-center text-xs">No services here yet.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-text-subtle text-left text-xs">
          <tr class="border-border border-b">
            <th class="px-4 py-2 font-medium">Service</th>
            <th class="px-4 py-2 text-right font-medium">Requests</th>
            <th class="px-4 py-2 text-right font-medium">Avg response</th>
            <th class="px-4 py-2 text-right font-medium">Errors</th>
            <th class="px-4 py-2 text-right font-medium">Served</th>
            <th class="px-4 py-2 text-right font-medium">Avg CPU</th>
            <th class="px-4 py-2 text-right font-medium">Avg memory</th>
          </tr>
        </thead>
        <tbody class="tabular-nums">
          {#each rows as row (row.serviceId)}
            <tr class="border-border hover:bg-surface-2 border-b last:border-0">
              <td class="px-4 py-2">
                <a class="text-text font-medium hover:underline" href={row.href}>
                  {row.name}
                </a>
                {#if row.context}
                  <span class="text-text-subtle ml-1 text-xs">{row.context}</span>
                {/if}
              </td>
              <td class="text-text px-4 py-2 text-right">{count(row.requests)}</td>
              <td class="text-text-muted px-4 py-2 text-right">{ms(row.avgResponseMs)}</td>
              <td class="text-text-muted px-4 py-2 text-right">
                {percent(row.status4xx + row.status5xx, row.requests)}
              </td>
              <td class="text-text-muted px-4 py-2 text-right">{formatBytes(row.bytesOut)}</td>
              <td class="text-text-muted px-4 py-2 text-right">
                {row.avgCpuPercent === null ? "—" : `${row.avgCpuPercent.toFixed(1)}%`}
              </td>
              <td class="text-text-muted px-4 py-2 text-right">{mb(row.avgMemUsedMb)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
