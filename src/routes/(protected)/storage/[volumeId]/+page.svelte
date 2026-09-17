<script lang="ts">
	import {
		ArrowLeft,
		Check,
		CheckCircle2,
		CloudUpload,
		RotateCcw,
		XCircle,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { formatBytes, timeAgo } from "$lib/formatting";
	import { getVolumeBackups } from "$lib/remote/backups.remote";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const vol = $derived(data.volume);

	onMount(() => title.set(`${vol.name} · Backup`));

	const label = "block mb-1.5 text-sm font-medium text-text";

	let submitting = $state(false);
	let backingUp = $state(false);
	let showBackups = $state(false);
	let restoringKey = $state<string | null>(null);
	let restoreDialogOpen = $state(false);
	let pendingRestoreKey = $state("");
	let pendingRestoreForm: HTMLFormElement | null = null;
	let restoreWipe = $state(false);
	let restoreStopServices = $state(true);
	let preCommandServiceId = $state(
		untrack(() => vol.backupPreCommandServiceId ?? ""),
	);
	const preCommandServiceLabel = $derived(
		data.services.find((service) => service.id === preCommandServiceId)?.name ??
			"First running service using this volume",
	);
	const restoreDescription = $derived(
		[
			`Queue a restore of "${pendingRestoreKey}" into ${vol.name}?`,
			restoreWipe
				? "Everything currently in the volume is deleted first."
				: "Files in the archive replace what's on disk and anything else is left alone.",
			restoreStopServices
				? "Running services using this volume are stopped for the restore and started again after."
				: "Nothing is stopped : restoring under a running container can leave it with half-old, half-new data.",
		].join(" "),
	);

	const backups = $derived(getVolumeBackups(data.volume.id));
	const destinationName = $derived(
		data.destinations.find((d) => d.id === vol.s3DestinationId)?.name ??
			"this destination",
	);

	function requestRestore(e: MouseEvent, key: string) {
		pendingRestoreForm = (e.currentTarget as HTMLElement).closest("form");
		pendingRestoreKey = key;
		restoreDialogOpen = true;
	}
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
    <h1 class="text-text text-lg font-semibold tracking-tight">{vol.name}</h1>
    <p class="mt-1 text-sm text-text-muted">
      {vol.kind}
      · {vol.source}
    </p>
  </div>

  <section class="rounded-md panel p-5">
    <div class="mb-4 flex items-center gap-3">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <CloudUpload class="size-4" />
      </div>
      <div>
        <p class="text-sm font-medium text-text">S3 backup</p>
        <p class="text-xs text-text-muted">
          {vol.kind === "bind"
            ? "Tars this directory"
            : "Tars this named volume, read through a short-lived helper container,"}
          and uploads it to an S3-compatible bucket. Disabled by default.
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
        helperText="Tar this volume and upload it to the S3 destination below on schedule"
        id="backupEnabled"
        label="Enable scheduled backups"
        name="backupEnabled"
      />

      <div>
        <label class={label} for="backupSchedule"
        >Schedule (cron syntax)</label>
        <Input
          class=""
          id="backupSchedule"
          name="backupSchedule"
          placeholder="0 3 * * *"
          type="text"
          value={vol.backupSchedule ?? ""}
        />
      </div>

      <CheckBox
        checked={vol.backupStopServices}
        helperText="Stop the running services that mount this volume while it's tarred, and start them again right after. Gives a consistent copy at the cost of a short outage."
        id="backupStopServices"
        label="Stop services during the backup"
        name="backupStopServices"
      />

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class={label} for="backupPreCommand"
          >Pre-backup command (optional)</label>
          <Input
            id="backupPreCommand"
            name="backupPreCommand"
            placeholder="pg_dump -U postgres -f /var/lib/postgresql/data/dump.sql app"
            type="text"
            value={vol.backupPreCommand ?? ""}
          />
          <p class="mt-1 text-xs text-text-muted">
            Runs with /bin/sh inside a service's container before each backup,
            while it's still running. Write the dump into this volume so it's
            part of the archive. A non-zero exit fails the backup.
          </p>
        </div>
        <div>
          <label class={label} for="backupPreCommandServiceId"
          >Run it in</label>
          {#if data.services.length === 0}
            <p class="text-xs text-text-muted">
              No service mounts this volume yet.
            </p>
          {:else}
            <SelectRoot
              name="backupPreCommandServiceId"
              type="single"
              bind:value={preCommandServiceId}
            >
              <SelectTrigger id="backupPreCommandServiceId">
                {preCommandServiceLabel}
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  label="First running service using this volume"
                  value=""
                />
                {#each data.services as service (service.id)}
                  <SelectItem label={service.name} value={service.id} />
                {/each}
              </SelectContent>
            </SelectRoot>
          {/if}
        </div>
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
      error: "Couldn't queue the backup.",
      loading: "Queueing the backup",
      success: "Backup queued : it shows up below once it starts.",
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

  {#if vol.s3DestinationId}
    <section class="rounded-md panel">
      <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 class="eyebrow">Restore</h2>
        <Button
          onclick={() => {
            showBackups = true;
            void backups.refresh();
          }}
          size="sm"
          variant="ghost"
        >
          <RotateCcw class="size-3.5" />
          {showBackups ? "Refresh list" : "List backups"}
        </Button>
      </div>
      <div class="p-5">
        {#if !showBackups}
          <p class="text-text-muted text-sm">
            Unpacks a backup from
            <span class="font-mono text-xs">{destinationName}</span>
            back into this volume, in the background. It shows up in the run
            log below like a backup does.
          </p>
        {:else if backups.error}
          <p class="text-sm text-red-500">
            Couldn't list this bucket : {backups.error.message}
          </p>
        {:else if !backups.current}
          <Skeleton class="h-16 w-full" />
        {:else if backups.current.length === 0}
          <p class="text-text-muted text-sm">
            No backups for this volume in that bucket yet.
          </p>
        {:else}
          <div class="mb-3 grid gap-3 sm:grid-cols-2">
            <CheckBox
              helperText="Delete everything in the volume before unpacking, so files that aren't in the backup don't survive the restore."
              id="restoreWipe"
              label="Wipe the volume first"
              name="restoreWipeToggle"
              bind:checked={restoreWipe}
            />
            <CheckBox
              helperText="Stop the running services that mount this volume for the restore, and start them again after."
              id="restoreStopServices"
              label="Stop services during the restore"
              name="restoreStopServicesToggle"
              bind:checked={restoreStopServices}
            />
          </div>
          <ul class="divide-border divide-y">
            {#each backups.current as backup (backup.key)}
              <li class="flex items-center gap-3 py-2">
                <div class="min-w-0 flex-1">
                  <p class="text-text truncate font-mono text-xs">
                    {backup.key}
                  </p>
                  <p class="text-text-subtle mt-0.5 text-xs">
                    {backup.lastModified
                      ? new Date(backup.lastModified).toLocaleString()
                      : "unknown date"}
                    · {formatBytes(backup.sizeBytes)}
                  </p>
                </div>
                <form
                  action="?/restore"
                  method="POST"
                  use:enhance={enhanceToast({
                    error: "Couldn't queue the restore.",
                    loading: "Queueing the restore",
                    onSettled: () => {
                      restoringKey = null;
                    },
                    onStart: () => {
                      restoringKey = backup.key;
                    },
                    success: "Restore queued : it shows up in the run log once it starts.",
                  })}
                >
                  <input name="key" type="hidden" value={backup.key}>
                  <input name="wipe" type="hidden" value={restoreWipe ? "on" : ""}>
                  <input
                    name="stopServices"
                    type="hidden"
                    value={restoreStopServices ? "on" : ""}
                  >
                  <Button
                    disabled={restoringKey !== null}
                    onclick={(e) => requestRestore(e, backup.key)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {#if restoringKey === backup.key}
                      <Spinner />
                      Queueing…
                    {:else}
                      Restore
                    {/if}
                  </Button>
                </form>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  {/if}

  {#if data.runs.length > 0}
    <section class="rounded-md panel">
      <div class="border-b border-border px-5 py-4">
        <h2 class="eyebrow">Run log</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left text-xs uppercase text-text-muted">
              <th class="px-5 py-3 font-medium">Started</th>
              <th class="px-5 py-3 font-medium">Kind</th>
              <th class="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each data.runs as run (run.id)}
              <tr class="border-b border-border/60 last:border-0">
                <td class="px-5 py-3 text-text-muted">
                  {new Date(run.startedAt).toLocaleString()}
                </td>
                <td class="px-5 py-3 text-text-muted" title={run.key ?? ""}>
                  {run.kind === "restore" ? "Restore" : "Backup"}
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
</div>

<ConfirmDialog
  bind:open={restoreDialogOpen}
  confirmLabel="Restore"
  description={restoreDescription}
  destructive={restoreWipe}
  onConfirm={() => pendingRestoreForm?.requestSubmit()}
  title="Restore this backup?"
/>
