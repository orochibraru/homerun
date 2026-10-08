<script lang="ts">
	import { Trash2, TriangleAlert } from "@lucide/svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let confirmOpen = $state(false);
	let deleteForm = $state<HTMLFormElement>();
</script>

<section class="bg-surface rounded-md border border-red-200 dark:border-red-900/40">
  <div class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30">
    <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
      <TriangleAlert class="size-4" />
    </div>
    <div>
      <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">Danger zone</h2>
      <p class="text-text-muted text-xs">
        Irreversible. Homerun forgets the backend, its versions and its lock.
        The state files stay in the bucket.
      </p>
    </div>
  </div>
  <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
    <div>
      <p class="text-text text-sm font-medium">Delete this state backend</p>
      <p class="text-text-muted text-xs">
        Terraform runs pointing at it fail until they use another backend.
      </p>
    </div>
    <form
      bind:this={deleteForm}
      action="?/delete"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't delete the backend.",
        loading: "Deleting the backend",
        onSuccess: () => goto(resolve("/(protected)/iac/state")),
        success: "Backend deleted.",
      })}
    >
      <Button
        onclick={() => {
          confirmOpen = true;
        }}
        type="button"
        variant="destructive"
      >
        <Trash2 class="size-3.5" />
        Delete backend
      </Button>
    </form>
  </div>
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Delete"
  description="Homerun forgets the backend, its versions and its lock. The state files stay in the bucket."
  onConfirm={() => deleteForm?.requestSubmit()}
  title={`Delete ${data.project.name}?`}
/>
