<script lang="ts">
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

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

  <form
    action="?/update"
    class="mb-6 space-y-4 rounded-md panel p-5"
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
        No scheme : just the host (and port, if not 443), same as what goes
        before the first slash in an image ref.
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

    <div class="flex justify-end gap-3">
      <Button disabled={submitting} type="submit" variant="outline">
        Save changes
      </Button>
    </div>
  </form>
</div>
