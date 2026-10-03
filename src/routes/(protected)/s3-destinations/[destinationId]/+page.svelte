<script lang="ts">
	import { PlugZap } from "@lucide/svelte";
	import { onMount } from "svelte";
	import {
		DESTINATION_TYPE_LABELS,
		describeDestination,
	} from "#lib/backup-destinations.js";
	import BackupDestinationFields from "#lib/components/backup-destination-fields.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data, form } = $props();

	const destination = $derived(data.destination);

	onMount(() => title.set("Backup Destination"));

	let submitting = $state(false);
	let testing = $state(false);
	let testResult = $state<{ error: string | null } | null>(null);
</script>

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div class="min-w-0">
      <h1 class="text-text text-lg font-semibold tracking-tight">
        {destination.name}
      </h1>
      <p class="text-text-muted mt-1 text-sm break-all">
        {DESTINATION_TYPE_LABELS[destination.type]} ·
        {describeDestination(destination)}
      </p>
    </div>
    <form
      action="?/test"
      method="POST"
      use:enhance={enhanceToast({
        error: "The destination test failed.",
        loading: "Writing a test file to the destination",
        onFailure: (failure) => {
          testResult = { error: String(failure?.error ?? "The test failed.") };
        },
        onSettled: () => {
          testing = false;
        },
        onStart: () => {
          testing = true;
          testResult = null;
        },
        onSuccess: () => {
          testResult = { error: null };
        },
        success: "The destination works.",
      })}
    >
      <Button disabled={testing} type="submit" variant="outline">
        <PlugZap class="size-4" />
        Test destination
      </Button>
    </form>
  </div>

  {#if testResult}
    <div
      class="mb-6 rounded-md border p-4 text-sm {testResult.error
        ? 'border-red-500/40 text-red-500'
        : 'border-emerald-500/40 text-emerald-500'}"
      role="status"
    >
      {#if testResult.error}
        <p class="font-medium">The test failed</p>
        <p class="mt-1 font-mono text-xs break-all whitespace-pre-wrap">{testResult.error}</p>
      {:else}
        <p class="font-medium">
          Reached it, wrote a test file and deleted it again.
        </p>
      {/if}
    </div>
  {/if}

  <div class="mb-6 grid gap-4 lg:grid-cols-2">
    <div class="panel rounded-md p-5">
      <h2 class="text-text text-sm font-semibold">Details</h2>
      <dl class="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt class="text-text-muted">Type</dt>
        <dd class="text-text">{DESTINATION_TYPE_LABELS[destination.type]}</dd>
        <dt class="text-text-muted">Address</dt>
        <dd class="text-text break-all">{describeDestination(destination)}</dd>
        <dt class="text-text-muted">Added</dt>
        <dd class="text-text">{timeAgo(destination.createdAt)}</dd>
        <dt class="text-text-muted">Last changed</dt>
        <dd class="text-text">{timeAgo(destination.updatedAt)}</dd>
      </dl>
    </div>
    <div class="panel rounded-md p-5">
      <h2 class="text-text text-sm font-semibold">Volumes backed up here</h2>
      {#if data.volumes.length === 0}
        <p class="text-text-muted mt-3 text-sm">
          No volume uses this destination yet. Pick it from a volume's backup
          settings.
        </p>
      {:else}
        <ul class="mt-3 space-y-2 text-sm">
          {#each data.volumes as volume (volume.id)}
            <li class="flex items-center justify-between gap-3">
              <a
                class="text-accent truncate underline"
                href={resolve("/(protected)/storage/[volumeId]", {
                  volumeId: volume.id,
                })}
              >
                {volume.name}
              </a>
              <span class="text-text-muted shrink-0 text-xs">
                {volume.backupEnabled ? "Scheduled" : "Schedule off"}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  <form
    action="?/update"
    class="mb-6 space-y-4 rounded-md panel p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Saving the destination",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Destination saved.",
    })}
  >
    <h2 class="text-text text-sm font-semibold">Settings</h2>
    {#if form?.error && !form.tested}
      <p class="text-sm text-red-500">{form.error}</p>
    {/if}
    <BackupDestinationFields {destination} />
    <p class="text-text-subtle text-xs">
      The test uses the saved settings: save a change before testing it.
    </p>

    <div class="flex justify-end gap-3">
      <Button disabled={submitting} type="submit" variant="outline">
        Save changes
      </Button>
    </div>
  </form>
</div>
