<script lang="ts">
	import { Clock, Play, Plus, Terminal, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityList from "$lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import RunStatusBadge from "$lib/components/run-status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { timeAgo } from "$lib/formatting";
	import { BASE_SORTS } from "$lib/list-sorts";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	onMount(() => title.set("Cron Jobs"));

	const view = new ViewMode("cron-jobs");

	const rows = $derived(
		data.jobs.map((job) => ({
			enabled: job.enabled,
			href: `${resolve("/cron-jobs")}/${job.id}`,
			id: job.id,
			kind: job.kind,
			name: job.name,
			subtitle: [
				job.schedule,
				job.kind === "exec" ? job.command : `${job.image}:${job.tag}`,
				job.lastRunAt ? `last run ${timeAgo(job.lastRunAt)}` : null,
			]
				.filter(Boolean)
				.join(" · "),
			title: job.name,
		})),
	);
	type JobRow = (typeof rows)[number];

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

{#snippet media(job: JobRow)}
  <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
    {#if job.kind === "exec"}
      <Terminal class="size-5" />
    {:else}
      <Clock class="size-5" />
    {/if}
  </div>
{/snippet}

{#snippet badge(job: JobRow)}
  {#if !job.enabled}
    <span class="bg-surface-2 text-text-subtle shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold">
      Disabled
    </span>
  {/if}
{/snippet}

{#snippet actions(job: JobRow)}
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
{/snippet}

<div class="p-5 md:p-6">
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Cron Jobs</h1>
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
    <EntityToolbar
    sorts={BASE_SORTS} {filters} placeholder="Search cron jobs…">
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.jobs.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No cron jobs match your search.</p>
      </div>
    {:else}
      <EntityList {actions} {badge} items={rows} {media} {view} />
      <Pagination
        label="cron jobs"
        page={data.page}
        perPage={data.perPage}
        total={data.total}
      />
    {/if}

    {#if data.runs.length > 0}
      <section class="panel mt-8 rounded-md">
        <PanelHeader title="Recent runs" />
        <div class="divide-border divide-y">
          {#each data.runs as entry (entry.run.id)}
            <div class="flex items-center gap-3 px-5 py-3 text-sm">
              <RunStatusBadge iconOnly success={entry.run.success}>
                {#snippet running()}
                  <Clock class="text-text-muted size-3.5 shrink-0" />
                {/snippet}
              </RunStatusBadge>
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
