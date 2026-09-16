<script lang="ts">
	import { AlertTriangle, ArrowLeft, Check, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const stack = $derived(data.stack);

	onMount(() => title.set(`${stack.name} · Settings`));

	let renaming = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteForm = $state<HTMLFormElement | null>(null);
	let deleting = $state(false);
</script>

<div class="p-5 md:p-6">
  <a
    class="text-text-muted hover:text-text mb-4 inline-flex items-center gap-1.5 text-sm"
    href={resolve("/(protected)/stacks/[stackId]", { stackId: stack.id })}
  >
    <ArrowLeft class="size-3.5" />
    {stack.name}
  </a>

  <div class="border-border mb-5 border-b pb-4">
    <h1 class="text-text text-lg font-semibold tracking-tight">
      Stack settings
    </h1>
    <p class="text-text-muted mt-0.5 text-xs">
      Its name, slug and description, and deleting it.
    </p>
  </div>

  <section class="panel mb-4 rounded-xl">
    <div class="panel-head">
      <h2 class="eyebrow">Stack</h2>
    </div>
    <form
      action="?/rename"
      class="space-y-4 p-4"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving the stack",
        onSettled: () => {
          renaming = false;
        },
        onStart: () => {
          renaming = true;
        },
        success: "Saved.",
      })}
    >
      {#if form?.error}
        <p class="text-sm text-red-500">{form.error}</p>
      {/if}
      <div>
        <label class={label} for="name">Name</label>
        <Input id="name" name="name" required type="text" value={stack.name} />
      </div>
      <div>
        <label class={label} for="slug">Slug</label>
        <Input
          id="slug"
          name="slug"
          pattern={"[a-z0-9-]{1,63}"}
          required
          type="text"
          value={stack.slug}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          Prefixes every member service's container name and public subdomain.
          Changing it takes effect on each service's next deploy.
        </p>
      </div>
      <div>
        <label class={label} for="description">Description</label>
        <Textarea
          class="resize-none"
          content={stack.description ?? ""}
          id="description"
          name="description"
          rows={2}
        />
      </div>
      <div class="flex justify-end">
        <Button disabled={renaming} type="submit">
          {#if renaming}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
      </div>
    </form>
  </section>

  <section class="rounded-xl border border-red-300/60 dark:border-red-900/50">
    <div class="flex items-center gap-3 border-b border-red-300/40 px-4 py-3 dark:border-red-900/40">
      <span class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
        <AlertTriangle class="size-4" />
      </span>
      <div>
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
          Danger zone
        </h2>
        <p class="text-text-muted text-xs">
          Deletes every service in this stack and their containers.
          Irreversible.
        </p>
      </div>
    </div>
    <div class="p-4">
      <form
        action="?/delete"
        method="POST"
        bind:this={deleteForm}
        use:enhance={enhanceToast({
          error: "Couldn't delete the stack.",
          loading: "Deleting the stack",
          onFailure: () => {
            deleting = false;
          },
          onStart: () => {
            deleting = true;
          },
          success: "Stack deleted.",
        })}
      >
        <Button
          class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
          disabled={deleting}
          onclick={() => {
            deleteDialogOpen = true;
          }}
          type="button"
          variant="outline"
        >
          {#if deleting}
            <Spinner />
          {:else}
            <Trash2 class="size-4" />
          {/if}
          Delete this stack
        </Button>
      </form>
    </div>
  </section>
</div>

<ConfirmDialog
  confirmLabel="Delete stack"
  description="Every service in this stack and its container is removed. This can't be undone."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete {stack.name}?"
  bind:open={deleteDialogOpen}
/>
