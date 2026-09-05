<script lang="ts">
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	onMount(() => title.set("New Build Cache Registry"));

	let submitting = $state(false);
</script>

<div class="p-6 md:p-8">
    <div class="mb-8">
        <h1 class="text-text text-xl font-semibold tracking-tight">Add a build cache registry</h1>
        <p class="mt-1 text-sm text-text-muted">
            Any Docker registry you can push to (a self-hosted registry, GHCR,
            Docker Hub). Only used to cache build layers, never as a deploy
            target.
        </p>
    </div>

    <form
        action="?/create"
        class="mb-6 space-y-4 rounded-2xl glass p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Check the form for errors.",
          loading: "Adding the registry",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          onSuccess: () =>
            goto(resolve("/build-cache-registries"), {
              invalidateAll: true,
            }),
          success: "Registry added.",
        })}
    >
        {#if form?.error}
            <p class="text-sm text-red-500">{form.error}</p>
        {/if}
        <div>
            <label class={label} for="name">Name</label>
            <Input
                id="name"
                name="name"
                placeholder="Self-hosted registry"
                required
                type="text"
            />
        </div>
        <div>
            <label class={label} for="registryUrl">Registry URL</label>
            <Input
                class="font-mono"
                id="registryUrl"
                name="registryUrl"
                placeholder="registry.example.com"
                required
                type="text"
            />
            <p class="mt-1.5 text-xs text-text-subtle">
                No scheme : just the host (and port, if not 443), same as what
                goes before the first slash in an image ref.
            </p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
            <div>
                <label class={label} for="username">Username</label>
                <Input id="username" name="username" required type="text" />
            </div>
            <div>
                <label class={label} for="password">Password / token</label>
                <Input id="password" name="password" required type="password" />
            </div>
        </div>

        <div class="flex justify-end gap-3">
            <Button disabled={submitting} type="submit" variant="outline">
                Add registry
            </Button>
        </div>
    </form>
</div>
