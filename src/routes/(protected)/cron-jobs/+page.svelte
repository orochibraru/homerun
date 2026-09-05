<script lang="ts">
	import {
		CheckCircle2,
		Clock,
		Play,
		Plus,
		Terminal,
		Trash2,
		XCircle,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set("Cron Jobs"));

	const filters: FilterGroup[] = [
		{
			key: "kind",
			label: "Type",
			options: [
				{ label: "Container", value: "image" },
				{ label: "Host command", value: "exec" },
			],
		},
		{
			key: "enabled",
			label: "Schedule",
			options: [
				{ label: "Enabled", value: "on" },
				{ label: "Disabled", value: "off" },
			],
		},
	];

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">Cron Jobs</h1>
      <p class="text-text-muted mt-1 text-sm">
        Scheduled one-off tasks : a throwaway container, or a shell command on
        this host. Every run goes through the job queue and keeps its output.
      </p>
    </div>
    <Button href={resolve("/cron-jobs/new")}>
      <Plus class="size-4" />
      New Cron Job
    </Button>
  </div>

  {#if data.total === 0 && !data.filtered}
    <EmptyState
      icon={Clock}
      subtitle="Run a database dump, a cleanup script, or any image on a schedule."
      title="No cron jobs yet"
    >
      <Button href={resolve("/cron-jobs/new")}>
        <Plus class="size-4" />
        Create your first cron job
      </Button>
    </EmptyState>
  {:else}
    <EntityToolbar {filters} placeholder="Search cron jobs…" />

    {#if data.jobs.length === 0}
      <div class="border-border/70 rounded-2xl border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No cron jobs match your search.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each data.jobs as job (job.id)}
          <div class="glass flex items-center gap-4 rounded-2xl p-5">
            <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
              {#if job.kind === "exec"}
                <Terminal class="size-5" />
              {:else}
                <Clock class="size-5" />
              {/if}
            </div>
            <a
              class="min-w-0 flex-1"
              href="{resolve('/cron-jobs')}/{job.id}"
            >
              <p class="text-text truncate text-sm font-semibold">
                {job.name}
                {#if !job.enabled}
                  <span class="text-text-subtle text-xs font-normal">
                    · disabled
                  </span>
                {/if}
              </p>
              <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
                {job.schedule}
                · {job.kind === "exec"
                  ? job.command
                  : `${job.image}:${job.tag}`}
                {#if job.lastRunAt}
                  · last run {timeAgo(job.lastRunAt)}
                {/if}
              </p>
            </a>

            <form
              action="?/runNow"
              method="POST"
              use:enhance={enhanceToast({
                error: "Couldn't queue that run.",
                loading: "Queueing the run",
                success: "Run queued.",
              })}
            >
              <input name="jobId" type="hidden" value={job.id}>
              <Button size="icon-sm" title="Run now" type="submit" variant="ghost">
                <Play class="size-4" />
              </Button>
            </form>

            <form
              action="?/delete"
              method="POST"
              use:enhance={enhanceToast({
                error: "Couldn't delete that cron job.",
                loading: "Deleting the cron job",
                success: "Cron job deleted.",
              })}
            >
              <input name="jobId" type="hidden" value={job.id}>
              <Button
                class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                onclick={(e) => requestDelete(e, job.name)}
                size="icon-sm"
                title="Delete"
                type="button"
                variant="ghost"
              >
                <Trash2 class="size-4" />
              </Button>
            </form>
          </div>
        {/each}
      </div>
      <Pagination
        label="cron jobs"
        page={data.page}
        perPage={data.perPage}
        total={data.total}
      />
    {/if}

    {#if data.runs.length > 0}
      <section class="glass mt-8 rounded-2xl">
        <div class="border-border border-b px-5 py-4">
          <h2 class="eyebrow">Recent runs</h2>
        </div>
        <div class="divide-border divide-y">
          {#each data.runs as entry (entry.run.id)}
            <div class="flex items-center gap-3 px-5 py-3 text-sm">
              {#if entry.run.success === null}
                <Clock class="text-text-muted size-3.5 shrink-0" />
              {:else if entry.run.success}
                <CheckCircle2 class="size-3.5 shrink-0 text-emerald-500" />
              {:else}
                <XCircle class="size-3.5 shrink-0 text-red-500" />
              {/if}
              <span class="text-text truncate">{entry.jobName}</span>
              <span class="text-text-muted ml-auto shrink-0 text-xs">
                {timeAgo(entry.run.startedAt)}
              </span>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? Its run history goes with it.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete cron job"
/>
