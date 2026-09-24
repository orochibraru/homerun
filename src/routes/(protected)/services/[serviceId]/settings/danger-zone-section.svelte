<script lang="ts">
	import { Trash2Icon, TriangleAlertIcon } from "@lucide/svelte";
	import { tick } from "svelte";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		name: string;
	}

	const { name }: Props = $props();

	let deleteDialogOpen = $state(false);
	let deleteForm = $state<HTMLFormElement | null>(null);
	let deleting = $state(false);
	let forceDelete = $state(false);
	let forceDeleteDialogOpen = $state(false);
	let detachError = $state("");
</script>

<section class="bg-surface rounded-md border border-red-200 dark:border-red-900/40">
  <div class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30">
    <div class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
      <TriangleAlertIcon class="size-4" />
    </div>
    <div>
      <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
        Danger zone
      </h2>
      <p class="text-text-muted text-xs">
        Irreversible. Removes the container and all deployment history.
      </p>
    </div>
  </div>
  <div class="p-5">
    <form
      action="?/delete"
      class="flex flex-wrap items-center justify-between gap-4"
      method="POST"
      bind:this={deleteForm}
      use:enhance={enhanceToast({
        error: "Couldn't delete the service.",
        loading: "Deleting the service",
        onFailure: (result) => {
          deleting = false;
          if (result?.detachFailed && !forceDelete) {
            detachError = String(result.error ?? "");
            forceDeleteDialogOpen = true;
          }
          forceDelete = false;
        },
        onStart: () => {
          deleting = true;
        },
        success: "Service deleted.",
      })}
    >
      <input name="force" type="hidden" value={forceDelete ? "true" : "false"} />
      <div>
        <p class="text-text text-sm font-medium">Delete this service</p>
        <p class="text-text-muted mt-0.5 text-xs">
          Its container will be stopped and removed. This can't be undone.
        </p>
      </div>
      <Button
        disabled={deleting}
        onclick={() => {
          deleteDialogOpen = true;
        }}
        type="button"
        variant="destructive"
      >
        {#if deleting}
          <Spinner />
          Deleting…
        {:else}
          <Trash2Icon class="size-4" />
          Delete service
        {/if}
      </Button>
    </form>
  </div>
</section>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete service"
  confirmPhrase={name}
  description={`Deleting "${name}" stops and removes its container and erases its deployment history. This can't be undone.`}
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete service"
/>

<ConfirmDialog
  bind:open={forceDeleteDialogOpen}
  confirmLabel="Delete anyway"
  description={`${detachError} Deleting anyway removes only Homerun's record of "${name}" : if its workload still exists on the host, remove it yourself.`}
  onConfirm={async () => {
    forceDelete = true;
    await tick();
    deleteForm?.requestSubmit();
  }}
  title="Delete the record anyway?"
/>
