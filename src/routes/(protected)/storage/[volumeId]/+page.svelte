<script lang="ts">
	import {
		ArrowLeft,
		Check,
		CheckCircle2,
		CloudUpload,
		XCircle,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const vol = $derived(data.volume);

	onMount(() => title.set(`${vol.name} · Backup`));

	const label = "block mb-1.5 text-sm font-medium text-text";

	let submitting = $state(false);
	let backingUp = $state(false);
	let s3DestinationId = $state(untrack(() => vol.s3DestinationId ?? ""));
	const destinationLabel = $derived(
		data.destinations.find((d) => d.id === s3DestinationId)?.name ??
			"Pick a destination…",
	);
</script>

<div class="space-y-6 p-6 md:p-8">
  <a
    class="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
    href={resolve("/storage")}
  >
    <ArrowLeft class="size-3.5" />
    Storage
  </a>

  <div>
    <h1 class="text-text text-xl font-semibold tracking-tight">{vol.name}</h1>
    <p class="mt-1 font-mono text-sm text-text-muted">
      {vol.kind}
      · {vol.source}
    </p>
  </div>

  {#if vol.kind !== "bind"}
    <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
      Only bind-mount volumes can be backed up right now : this is a
      Docker-managed named volume.
    </div>
  {:else}
    <section class="rounded-2xl glass p-5">
      <div class="mb-4 flex items-center gap-3">
        <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
          <CloudUpload class="size-4" />
        </div>
        <div>
          <p class="text-sm font-medium text-text">S3 backup</p>
          <p class="text-xs text-text-muted">
            Tars this directory and uploads it to an S3-compatible bucket.
            Disabled by default.
            {#if vol.backupLastRunAt}
              · last run {timeAgo(vol.backupLastRunAt)}
            {/if}
          </p>
        </div>
      </div>

      <form
        action="?/updateBackup"
        class="space-y-3"
        method="POST"
        use:enhance={enhanceToast({
          error: "Check the form for errors.",
          loading: "Saving the volume",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          success: "Saved.",
        })}
      >
        {#if form?.error}
          <p class="text-xs text-red-500">{form.error}</p>
        {/if}

        <CheckBox
          checked={vol.backupEnabled}
          helperText="Tar this directory and upload it to the S3 destination below on schedule"
          id="backupEnabled"
          label="Enable scheduled backups"
          name="backupEnabled"
        />

        <div>
          <label class={label} for="backupSchedule"
          >Schedule (cron syntax)</label>
          <Input
            class="font-mono"
            id="backupSchedule"
            name="backupSchedule"
            placeholder="0 3 * * *"
            type="text"
            value={vol.backupSchedule ?? ""}
          />
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class={label} for="s3DestinationId">S3 destination</label>
            {#if data.destinations.length === 0}
              <p class="text-xs text-text-muted">
                No destinations configured yet.
                <a class="text-accent underline" href={resolve("/s3-destinations")}>
                  Add one
                </a>
                first.
              </p>
            {:else}
              <SelectRoot
                name="s3DestinationId"
                type="single"
                bind:value={s3DestinationId}
              >
                <SelectTrigger id="s3DestinationId">{destinationLabel}</SelectTrigger>
                <SelectContent>
                  {#each data.destinations as dest (dest.id)}
                    <SelectItem label={dest.name} value={dest.id} />
                  {/each}
                </SelectContent>
              </SelectRoot>
            {/if}
          </div>
          <div>
            <label class={label} for="backupPrefix"
            >Key prefix (optional)</label>
            <Input
              id="backupPrefix"
              name="backupPrefix"
              placeholder="backups/my-app"
              type="text"
              value={vol.backupPrefix ?? ""}
            />
          </div>
        </div>

        <Button disabled={submitting} type="submit">
          {#if submitting}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
      </form>
    </section>

    <form
      action="?/backupNow"
      method="POST"
      use:enhance={enhanceToast({
        error: "Backup failed : check the volume's config.",
        loading: "Uploading the backup",
        success: "Backup uploaded.",
      })}
    >
      <Button
        disabled={backingUp || !vol.s3DestinationId}
        type="submit"
        variant="outline"
      >
        {#if backingUp}
          <Spinner />
          Backing up…
        {:else}
          <CloudUpload class="size-4" />
          Backup now
        {/if}
      </Button>
    </form>

    {#if data.runs.length > 0}
      <section class="rounded-2xl glass">
        <div class="border-b border-border px-5 py-4">
          <h2 class="eyebrow">Run log</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border text-left text-xs uppercase text-text-muted">
                <th class="px-5 py-3 font-medium">Started</th>
                <th class="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each data.runs as run (run.id)}
                <tr class="border-b border-border/60 last:border-0">
                  <td class="px-5 py-3 text-text-muted">
                    {new Date(run.startedAt).toLocaleString()}
                  </td>
                  <td class="px-5 py-3">
                    {#if run.success === null}
                      <span class="text-xs text-text-muted">Running</span>
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
      </section>
    {/if}
  {/if}
</div>
