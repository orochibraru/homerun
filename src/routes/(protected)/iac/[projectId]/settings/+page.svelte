<script lang="ts">
	import { Settings, Trash2, TriangleAlert } from "@lucide/svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import IacScopePicker from "#lib/components/iac-scope-picker.svelte";
	import IacToolPicker from "#lib/components/iac-tool-picker.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let confirmOpen = $state(false);
	let deleteForm = $state<HTMLFormElement>();
	let saving = $state(false);
	let tool = $derived(data.project.tool);
	let scope = $derived(data.project.scope ?? "");
</script>

<div class="space-y-5">
<section class="panel rounded-md">
  <PanelHeader
    description="Switching between Terraform and OpenTofu is free. Moving to or from Pulumi doesn't convert the state: the versions here stay, Pulumi keeps its own."
    icon={Settings}
    title="General"
  >
    {#snippet trailing()}
      <SaveButton form="iac-project-settings" pending={saving} />
    {/snippet}
  </PanelHeader>
  <form
    id="iac-project-settings"
    class="space-y-5 px-5 py-4"
    action="?/update"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Saving the project",
      onSettled: () => {
        saving = false;
      },
      onStart: () => {
        saving = true;
      },
      success: "Project saved.",
    })}
  >
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class={labelClass} for="iac-settings-name">Name</label>
        <input
          id="iac-settings-name"
          class={inputClass}
          autocomplete="off"
          name="name"
          required
          value={data.project.name}
        >
      </div>
      <div>
        <label class={labelClass} for="iac-settings-scope">What it manages</label>
        <IacScopePicker
          id="iac-settings-scope"
          allowNone
          name="scope"
          scopes={data.scopes}
          bind:value={scope}
        />
      </div>
    </div>
    <div>
      <p class={labelClass}>Tool</p>
      <IacToolPicker name="tool" bind:value={tool} />
    </div>
  </form>
</section>

<section class="bg-surface rounded-md border border-red-200 dark:border-red-900/40">
  <div class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30">
    <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
      <TriangleAlert class="size-4" />
    </div>
    <div>
      <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">Danger zone</h2>
      <p class="text-text-muted text-xs">
        Irreversible. Homerun forgets the project, its versions and its lock.
        The state files stay in the bucket.
      </p>
    </div>
  </div>
  <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
    <div>
      <p class="text-text text-sm font-medium">Delete this project</p>
      <p class="text-text-muted text-xs">
        Runs pointing at its backend fail until they use another one.
      </p>
    </div>
    <form
      bind:this={deleteForm}
      action="?/delete"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't delete the project.",
        loading: "Deleting the project",
        onSuccess: () => goto(resolve("iac")),
        success: "Project deleted.",
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
        Delete project
      </Button>
    </form>
  </div>
</section>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Delete"
  description="Homerun forgets the project, its versions and its lock. The state files stay in the bucket."
  onConfirm={() => deleteForm?.requestSubmit()}
  title={`Delete ${data.project.name}?`}
/>
