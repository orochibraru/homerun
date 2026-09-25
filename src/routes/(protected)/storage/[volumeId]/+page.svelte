<script lang="ts">
	import { Check, CloudUpload } from "@lucide/svelte";
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
	import RestorePanel from "./restore-panel.svelte";
	import RunLogTable from "./run-log-table.svelte";

	const { data, form } = $props();
	const vol = $derived(data.volume);

	onMount(() => title.set(`${vol.name} · Backup`));

	const label = "block mb-1.5 text-sm font-medium text-text";

	let submitting = $state(false);
	let backingUp = $state(false);
	let preCommandServiceId = $state(
		untrack(() => vol.backupPreCommandServiceId ?? ""),
	);
	const preCommandServiceLabel = $derived(
		data.services.find((service) => service.id === preCommandServiceId)?.name ??
			"First running service using this volume",
	);
	const destinationName = $derived(
		data.destinations.find((d) => d.id === vol.s3DestinationId)?.name ??
			"this destination",
	);

	let s3DestinationId = $state(untrack(() => vol.s3DestinationId ?? ""));
	const destinationLabel = $derived(
		data.destinations.find((d) => d.id === s3DestinationId)?.name ??
			"Pick a destination…",
	);
</script>

<div class="space-y-6">

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
    <RestorePanel
      {destinationName}
      volumeId={vol.id}
      volumeName={vol.name}
    />
  {/if}

  {#if data.runs.length > 0}
    <RunLogTable runs={data.runs} />
  {/if}
</div>
