<script lang="ts">
	import { CheckCircle2, CloudUpload, Play, XCircle } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set("Backups"));

	const backupEnabledVolumes = $derived(
		data.volumes.filter((v) => v.backupEnabled),
	);

	let runningVolumeId = $state<string | null>(null);

	function formatDate(value: Date | string | null): string {
		if (!value) {
			return "—";
		}
		return new Date(value).toLocaleString();
	}

	function formatSize(bytes: number | null): string {
		if (bytes == null) {
			return "";
		}
		const units = ["B", "KB", "MB", "GB"];
		let value = bytes;
		let i = 0;
		while (value >= 1024 && i < units.length - 1) {
			value /= 1024;
			i += 1;
		}
		return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">Backups</h1>
      <p class="text-text-muted mt-1 text-sm">
        Per-volume S3 backups and their run history. Configure a volume's
        destination and schedule from its own page.
      </p>
    </div>
    <Button href={resolve("/s3-destinations")} variant="outline">
      Manage S3 destinations
    </Button>
  </div>

  <!-- ═══ Configured volumes ═══ -->
  <section class="mb-8">
    <h2 class="eyebrow mb-3">Backup-enabled volumes</h2>
    {#if backupEnabledVolumes.length === 0}
      <EmptyState
        icon={CloudUpload}
        subtitle="Enable backups on a volume's own page under Storage."
        title="No volumes have backups enabled"
      >
        {#snippet children()}
          <Button href={resolve("/storage")} variant="outline">
            Go to Storage
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="space-y-2.5">
        {#each backupEnabledVolumes as vol (vol.id)}
          <div class="glass flex items-center gap-4 rounded-2xl p-4">
            <div class="min-w-0 flex-1">
              <a
                class="text-text hover:text-accent truncate text-sm font-semibold"
                href="{resolve('/storage')}/{vol.id}"
              >
                {vol.name}
              </a>
              <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
                {vol.backupSchedule}
                · {vol.destinationName}
              </p>
              <p class="text-text-subtle mt-0.5 text-xs">
                last run: {formatDate(vol.backupLastRunAt)}
              </p>
            </div>
            <form
              action="?/run"
              method="POST"
              use:enhance={enhanceToast({
                error: "Couldn't queue the backup.",
                loading: "Queueing the backup",
                success: "Backup queued : it shows up below once it starts.",
              })}
            >
              <input name="volumeId" type="hidden" value={vol.id}>
              <Button disabled={runningVolumeId === vol.id} type="submit" variant="outline">
                {#if runningVolumeId === vol.id}
                  <Spinner />
                {:else}
                  <Play class="size-4" />
                {/if}
                Run now
              </Button>
            </form>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ═══ Run log ═══ -->
  <section>
    <h2 class="eyebrow mb-3">Run log</h2>
    {#if data.runs.length === 0}
      <EmptyState
        icon={CloudUpload}
        subtitle="Runs (scheduled or manual) will show up here."
        title="No backup runs yet"
      />
    {:else}
      <div class="glass overflow-x-auto rounded-2xl">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
              <th class="px-4 py-3 font-medium">Volume</th>
              <th class="px-4 py-3 font-medium">Started</th>
              <th class="px-4 py-3 font-medium">Duration</th>
              <th class="px-4 py-3 font-medium">Size</th>
              <th class="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each data.runs as run (run.id)}
              {@const durationMs = run.finishedAt
              ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
              : null}
              <tr class="border-border/60 border-b last:border-0">
                <td class="text-text px-4 py-3 font-medium">{run.volumeName}</td>
                <td class="text-text-muted px-4 py-3">{formatDate(run.startedAt)}</td>
                <td class="text-text-muted px-4 py-3">
                  {durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : "—"}
                </td>
                <td class="text-text-muted px-4 py-3">{formatSize(run.sizeBytes)}</td>
                <td class="px-4 py-3">
                  {#if run.success === null}
                    <span class="text-text-muted flex items-center gap-1 text-xs">
                      <Spinner class="size-3" />
                      Running
                    </span>
                  {:else if run.success}
                    <span class="flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 class="size-3.5" />
                      Success
                    </span>
                  {:else}
                    <span
                      class="flex items-center gap-1 text-xs text-red-500"
                      title={run.error ?? ""}
                    >
                      <XCircle class="size-3.5" />
                      Failed
                    </span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
