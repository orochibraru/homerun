<script lang="ts">
	import { ArrowLeft, ScrollText } from "@lucide/svelte";
	import { onMount } from "svelte";
	import DeployLogPanel from "#lib/components/deploy-log-panel.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import TraceWaterfall from "#lib/components/tracing/trace-waterfall.svelte";
	import { JOB_STATUS_CONFIG, JOB_TYPE_LABELS } from "#lib/constants.js";
	import { formatDuration } from "#lib/resource-incidents.js";
	import { title } from "#lib/store/title.js";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";

	const POLL_MS = 2000;

	const { data } = $props();

	const meta = $derived(JOB_STATUS_CONFIG[data.job.status]);
	const live = $derived(
		data.job.status === "queued" || data.job.status === "running",
	);

	onMount(() => title.set(`Scheduling · ${data.job.title}`));

	$effect(() => {
		if (!live) {
			return;
		}
		const timer = setInterval(() => void refreshAll(), POLL_MS);
		return () => clearInterval(timer);
	});

	function when(value: Date | null): string {
		return value ? new Date(value).toLocaleString() : "—";
	}
</script>

<div class="flex min-h-full flex-col p-5 md:p-6">
  <a
    class="text-text-muted hover:text-text mb-5 inline-flex items-center gap-1 self-start text-sm"
    href={resolve("/(protected)/scheduling")}
  >
    <ArrowLeft class="size-4" />
    Scheduling
  </a>

  <section class="panel flex flex-1 flex-col rounded-md">
    <PanelHeader
      description={JOB_TYPE_LABELS[data.job.type]}
      icon={ScrollText}
      title={data.job.title}
    >
      {#snippet trailing()}
        <span
          class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.65rem] font-medium tracking-wider uppercase {meta.class}"
        >
          <meta.icon class="size-3 {data.job.status === 'running' ? 'animate-spin' : ''}" />
          {meta.label}
        </span>
      {/snippet}
    </PanelHeader>
    <dl class="grid gap-3 px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
      <div>
        <dt class="text-text-muted text-xs">Queued</dt>
        <dd class="text-text mt-0.5">{when(data.job.createdAt)}</dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Started</dt>
        <dd class="text-text mt-0.5">{when(data.job.startedAt)}</dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Finished</dt>
        <dd class="text-text mt-0.5">{when(data.job.finishedAt)}</dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Took</dt>
        <dd class="text-text mt-0.5">
          {data.job.startedAt && data.job.finishedAt
            ? formatDuration(new Date(data.job.finishedAt).getTime() - new Date(data.job.startedAt).getTime())
            : "—"}
        </dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Worker</dt>
        <dd class="text-text mt-0.5 font-mono text-xs">{data.job.workerVersion ?? "—"}</dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Attempt</dt>
        <dd class="text-text mt-0.5 tabular-nums">
          {data.job.attempts}/{data.job.maxAttempts}{data.job.stage ? ` · ${data.job.stage}` : ""}
        </dd>
      </div>
    </dl>
    {#if data.job.summary}
      <p class="text-text border-border border-t px-5 py-3 text-sm font-medium">{data.job.summary}</p>
    {/if}
    {#each data.traces as trace, index (trace.traceId)}
      <div class="border-border space-y-2 border-t px-5 py-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="eyebrow">{data.traces.length > 1 ? `Trace · attempt ${index + 1}` : "Trace"}</h3>
          <a
            class="text-accent text-xs hover:underline"
            href={resolve("/(protected)/monitoring/traces/[traceId]", { traceId: trace.traceId })}
          >
            Open trace
          </a>
        </div>
        <TraceWaterfall spans={trace.spans} />
      </div>
    {/each}
    {#if data.job.log || data.job.error}
      <DeployLogPanel errorMessage={data.job.error} fill log={data.job.log} logName="job log" />
    {:else}
      <EmptyState
        icon={ScrollText}
        subtitle={live ? "The log fills in as the job runs." : "This job didn't write anything."}
        title="No log yet"
      />
    {/if}
  </section>
</div>
