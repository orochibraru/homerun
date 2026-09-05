<script lang="ts">
	import { ListChecks } from "@lucide/svelte";
	import { onMount } from "svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { JOB_STATUS_CONFIG, JOB_TYPE_LABELS } from "$lib/constants";
	import { getJobQueue, type QueuedJob } from "$lib/remote/jobs.remote";

	const POLL_MS = 3000;

	const queue = getJobQueue();

	const active = $derived(queue.current?.active ?? []);
	const recent = $derived(queue.current?.recent ?? []);

	onMount(() => {
		const timer = setInterval(() => {
			if (queue.current?.active.length) {
				void queue.refresh();
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	});

	function formatFinished(value: Date | null): string {
		return value ? new Date(value).toLocaleString() : "";
	}
</script>

{#snippet row(entry: QueuedJob)}
  {@const meta = JOB_STATUS_CONFIG[entry.status]}
  <div class="glass flex items-center gap-4 rounded-2xl p-4">
    <div class="min-w-0 flex-1">
      <p class="text-text truncate text-sm font-semibold">{entry.title}</p>
      <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
        {JOB_TYPE_LABELS[entry.type]}
        {#if entry.maxAttempts > 1}
          · attempt {entry.attempts}/{entry.maxAttempts}
        {/if}
        {#if entry.error}
          · {entry.error}
        {/if}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      {#if entry.finishedAt}
        <span class="text-text-subtle text-xs">{formatFinished(entry.finishedAt)}</span>
      {/if}
      <span
        class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.65rem] font-medium tracking-wider uppercase {meta.class}"
      >
        {#if entry.status === "running"}
          <meta.icon class="size-3 animate-spin" />
        {:else}
          <meta.icon class="size-3" />
        {/if}
        {meta.label}
      </span>
    </div>
  </div>
{/snippet}

<section>
  <div class="mb-3 flex items-center gap-2">
    <ListChecks class="text-accent size-4" />
    <h2 class="eyebrow">Job queue</h2>
  </div>
  <p class="text-text-muted mb-3 text-xs">
    Deploys, builds, backups and Docker cleanups all run through one worker :
    one job per service at a time, and a host-wide cleanup runs alone.
  </p>

  {#if !queue.ready}
    <div class="space-y-2.5">
      {#each [0, 1] as placeholder (placeholder)}
        <div class="glass flex items-center gap-4 rounded-2xl p-4">
          <div class="min-w-0 flex-1 space-y-1.5">
            <Skeleton class="h-4 w-48" />
            <Skeleton class="h-3 w-32" />
          </div>
          <Skeleton class="h-5 w-20" />
        </div>
      {/each}
    </div>
  {:else if active.length === 0 && recent.length === 0}
    <EmptyState
      icon={ListChecks}
      subtitle="Deploys, backups and cleanups show up here while they run."
      title="Nothing in the queue"
    />
  {:else}
    <div class="space-y-2.5">
      {#each active as entry (entry.id)}
        {@render row(entry)}
      {/each}
      {#each recent as entry (entry.id)}
        {@render row(entry)}
      {/each}
    </div>
  {/if}
</section>
