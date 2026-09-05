<script lang="ts">
	import {
		ArrowLeft,
		Check,
		CheckCircle2,
		ChevronDown,
		Play,
		Trash2,
		XCircle,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import CronJobFields from "$lib/components/cron-job-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	const job = $derived(data.job);

	onMount(() => title.set(job.name));

	let submitting = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteForm: HTMLFormElement | undefined = $state();
	let expandedRunId = $state<string | null>(null);
</script>

<div class="space-y-6 p-6 md:p-8">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1.5 text-sm"
    href={resolve("/cron-jobs")}
  >
    <ArrowLeft class="size-3.5" />
    Cron Jobs
  </a>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">{job.name}</h1>
      <p class="text-text-muted mt-0.5 font-mono text-sm">
        {job.schedule}
        · {job.kind === "exec" ? "host command" : `${job.image}:${job.tag}`}
        {#if job.lastRunAt}
          · last run {timeAgo(job.lastRunAt)}
        {/if}
      </p>
    </div>
    <form
      action="?/runNow"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't queue that run.",
        loading: "Queueing the run",
        success: "Run queued : it shows up below once it finishes.",
      })}
    >
      <Button type="submit" variant="outline">
        <Play class="size-4" />
        Run now
      </Button>
    </form>
  </div>

  {#if form?.error}
    <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
      {form.error}
    </div>
  {/if}

  <form
    action="?/update"
    class="space-y-4"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save that cron job.",
      loading: "Saving the cron job",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Saved.",
    })}
  >
    <CronJobFields
      canUseExec={data.canUseExec}
      values={{
        command: job.command,
        description: job.description,
        enabled: job.enabled,
        envVars: job.envVars ?? {},
        image: job.image,
        kind: job.kind,
        name: job.name,
        registryUrl: job.registryUrl,
        registryUsername: job.registryUsername,
        schedule: job.schedule,
        tag: job.tag,
        timeoutSeconds: job.timeoutSeconds,
      }}
    />

    <Button disabled={submitting} type="submit">
      {#if submitting}
        <Spinner />
      {:else}
        <Check class="size-4" />
      {/if}
      Save
    </Button>
  </form>

  {#if data.runs.length > 0}
    <section class="glass rounded-2xl">
      <div class="border-border border-b px-5 py-4">
        <h2 class="eyebrow">Run history</h2>
      </div>
      <div class="divide-border divide-y">
        {#each data.runs as run (run.id)}
          <div>
            <button
              class="flex w-full items-center gap-3 px-5 py-3 text-left text-sm"
              onclick={() => {
                expandedRunId = expandedRunId === run.id ? null : run.id;
              }}
              type="button"
            >
              {#if run.success === null}
                <Spinner class="size-3.5 shrink-0" />
              {:else if run.success}
                <CheckCircle2 class="size-3.5 shrink-0 text-emerald-500" />
              {:else}
                <XCircle class="size-3.5 shrink-0 text-red-500" />
              {/if}
              <span class="text-text-muted min-w-0 flex-1 truncate text-xs">
                {new Date(run.startedAt).toLocaleString()}
                {#if run.exitCode !== null}
                  · exit {run.exitCode}
                {/if}
                {#if run.error}
                  · <span class="text-red-500">{run.error}</span>
                {/if}
              </span>
              {#if run.output}
                <ChevronDown
                  class="text-text-muted size-4 shrink-0 transition-transform {expandedRunId ===
                  run.id
                    ? 'rotate-180'
                    : ''}"
                />
              {/if}
            </button>
            {#if expandedRunId === run.id && run.output}
              <div class="mx-5 mb-3 max-h-64 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
                {#each run.output.split("\n").filter(Boolean) as line, i (i)}
                  <AnsiLine {line} />
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="rounded-2xl border border-red-200 p-5 dark:border-red-900/40">
    <h2 class="eyebrow text-red-500">Danger zone</h2>
    <p class="text-text-muted mt-1 text-sm">
      Deleting this cron job also deletes its run history.
    </p>
    <form action="?/delete" bind:this={deleteForm} class="mt-3" method="POST">
      <Button
        class="border-red-200 bg-red-600/10 text-red-600 dark:border-red-600"
        onclick={() => {
          deleteDialogOpen = true;
        }}
        type="button"
        variant="outline"
      >
        <Trash2 class="size-4" />
        Delete cron job
      </Button>
    </form>
  </section>
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  confirmPhrase={job.name}
  description={`Delete "${job.name}"? Its run history goes with it.`}
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete cron job"
/>
