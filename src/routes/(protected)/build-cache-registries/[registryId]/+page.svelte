<script lang="ts">
	import { onMount } from "svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data, form } = $props();

	const registry = $derived(data.registry);

	onMount(() => title.set("Edit Build Cache Registry"));

	let submitting = $state(false);
</script>

<div class="p-5 md:p-6">
  <div class="mb-8">
    <h1 class="text-text text-lg font-semibold tracking-tight">
      {registry.name}
    </h1>
    <p class="text-text-muted mt-1 text-sm">
      Services already pointing at this registry pick the new details up on
      their next build.
    </p>
  </div>

  <section class="panel mb-6 rounded-md">
    <PanelHeader title="Registry">
      {#snippet trailing()}
        <SaveButton form="build-cache-registry" pending={submitting} />
      {/snippet}
    </PanelHeader>
    <form
      id="build-cache-registry"
      action="?/update"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving the registry",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Registry saved.",
      })}
    >
      {#if form?.error}
        <p class="text-sm text-red-500">{form.error}</p>
      {/if}
      <div>
        <label class={label} for="name">Name</label>
        <Input id="name" name="name" required type="text" value={registry.name} />
      </div>
      <div>
        <label class={label} for="registryUrl">Registry URL</label>
        <Input
          id="registryUrl"
          name="registryUrl"
          required
          type="text"
          value={registry.registryUrl}
        />
        <p class="mt-1.5 text-xs text-text-subtle">
          No scheme : the host (and port, if not 443), plus the namespace your
          registry keeps images under when it needs one, e.g.
          <code>git.example.com/&lt;owner&gt;</code> for Gitea or
          <code>ghcr.io/&lt;user&gt;</code>.
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class={label} for="username">Username</label>
          <Input
            id="username"
            name="username"
            required
            type="text"
            value={registry.username}
          />
        </div>
        <div>
          <label class={label} for="password">Password / token</label>
          <Input
            id="password"
            name="password"
            placeholder="Leave blank to keep current"
            type="password"
          />
        </div>
      </div>
    </form>
  </section>
</div>
