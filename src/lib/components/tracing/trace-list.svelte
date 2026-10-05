<script lang="ts">
	import { Activity, ChevronRight } from "@lucide/svelte";
	import Alert from "#lib/components/alert.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "#lib/components/entity-toolbar.svelte";
	import Pagination from "#lib/components/pagination.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { TRACE_SORTS } from "#lib/tracing/list.js";
	import {
		formatSpanDuration,
		type TraceSummary,
	} from "#lib/tracing/waterfall.js";

	interface TraceListing {
		items: TraceSummary[];
		page: number;
		perPage: number;
		total: number;
	}

	interface Props {
		emptySubtitle: string;
		emptyTitle: string;
		listing: Promise<TraceListing>;
		searched: boolean;
		traceHref: (traceId: string) => string;
	}

	const { emptySubtitle, emptyTitle, listing, searched, traceHref }: Props =
		$props();

	const filters: FilterGroup[] = [
		{
			key: "status",
			label: "Status",
			options: [{ label: "Errors only", value: "error" }],
		},
	];

	function reason(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
</script>

<div class="space-y-3">
  <EntityToolbar
    filters={filters}
    placeholder="Search span names or a trace id…"
    sorts={TRACE_SORTS}
  />

  {#await listing}
    <div class="space-y-2">
      {#each { length: 6 }, i (i)}
        <Skeleton class="h-12 w-full" />
      {/each}
    </div>
  {:then result}
    {#if result.total === 0 && !searched}
      <EmptyState icon={Activity} subtitle={emptySubtitle} title={emptyTitle} />
    {:else if result.items.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No trace matches your filters.</p>
      </div>
    {:else}
      <div class="panel overflow-x-auto rounded-md">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
              <th class="px-4 py-3 font-medium">Root span</th>
              <th class="px-4 py-3 text-right font-medium">Duration</th>
              <th class="hidden px-4 py-3 text-right font-medium sm:table-cell">Spans</th>
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">Started</th>
              <th class="w-8 px-4 py-3"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {#each result.items as trace (trace.traceId)}
              <tr class="border-border/60 hover:bg-surface-2 group relative border-b last:border-0">
                <td class="max-w-0 px-4 py-3">
                  <a
                    class="text-text group-hover:text-accent block truncate font-medium after:absolute after:inset-0"
                    href={traceHref(trace.traceId)}
                  >
                    {trace.rootName || "(unnamed span)"}
                  </a>
                  <span class="text-text-subtle block truncate text-xs">
                    {trace.serviceName} · <span class="font-mono">{trace.traceId.slice(0, 16)}</span>
                  </span>
                </td>
                <td class="text-text px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                  {formatSpanDuration(trace.durationMs)}
                </td>
                <td class="text-text-muted hidden px-4 py-3 text-right sm:table-cell">{trace.spanCount}</td>
                <td class="px-4 py-3">
                  {#if trace.errorCount > 0}
                    <span class="rounded-full bg-red-500/10 px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap text-red-500 uppercase">
                      {trace.errorCount} {trace.errorCount === 1 ? "error" : "errors"}
                    </span>
                  {:else}
                    <span class="rounded-full bg-green-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-green-600 uppercase">ok</span>
                  {/if}
                </td>
                <td
                  class="text-text-muted hidden px-4 py-3 whitespace-nowrap md:table-cell"
                  title={new Date(trace.startTime).toLocaleString()}
                >
                  {timeAgo(trace.startTime)}
                </td>
                <td class="text-text-subtle px-4 py-3"><ChevronRight class="size-4" /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pagination
        label="traces"
        page={result.page}
        perPage={result.perPage}
        total={result.total}
      />
    {/if}
  {:catch error}
    <Alert title="Couldn't load the traces.">{reason(error)}</Alert>
  {/await}
</div>
