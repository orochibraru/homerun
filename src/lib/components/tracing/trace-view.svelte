<script lang="ts">
	import { ArrowLeft } from "@lucide/svelte";
	import CopyButton from "#lib/components/copy-button.svelte";
	import TraceWaterfall, {
		type WaterfallSpan,
	} from "#lib/components/tracing/trace-waterfall.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import {
		buildWaterfall,
		formatSpanDuration,
		STATUS_ERROR,
	} from "#lib/tracing/waterfall.js";

	interface Props {
		backHref: string;
		backLabel: string;
		spans: WaterfallSpan[];
		traceId: string;
	}

	const { backHref, backLabel, spans, traceId }: Props = $props();

	const layout = $derived(buildWaterfall(spans));
	const root = $derived(layout.rows[0]?.span ?? null);
	const errors = $derived(
		spans.filter((span) => span.statusCode === STATUS_ERROR).length,
	);
	const services = $derived([
		...new Set(spans.map((span) => span.serviceName)),
	]);

	const facts = $derived([
		["Duration", formatSpanDuration(layout.totalMs)],
		["Spans", String(spans.length)],
		["Errors", String(errors)],
		["Services", services.join(", ")],
		["Started", layout.startMs ? timeAgo(new Date(layout.startMs)) : "—"],
	]);
</script>

<div class="space-y-6">
  <div class="space-y-3">
    <a class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm" href={backHref}>
      <ArrowLeft class="size-3.5" />
      {backLabel}
    </a>
    <div class="min-w-0 space-y-1">
      <h2 class="text-text text-base font-semibold wrap-break-word">{root?.name || "(unnamed span)"}</h2>
      <p class="text-text-muted flex items-center gap-1 font-mono text-xs break-all">
        trace {traceId}
        <CopyButton label="trace id" value={traceId} />
      </p>
    </div>
  </div>

  <dl class="panel grid grid-cols-2 gap-4 rounded-md p-4 sm:grid-cols-3 lg:grid-cols-5">
    {#each facts as [name, value] (name)}
      <div class="min-w-0">
        <dt class="text-text-subtle text-xs">{name}</dt>
        <dd
          class="truncate font-mono text-sm {name === 'Errors' && errors > 0 ? 'text-red-500' : 'text-text'}"
          title={value}
        >
          {value}
        </dd>
      </div>
    {/each}
  </dl>

  <TraceWaterfall {spans} />
</div>
