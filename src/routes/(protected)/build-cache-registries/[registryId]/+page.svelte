<script lang="ts">
	import { Layers } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
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

  <section class="panel rounded-md">
    <PanelHeader
      description="Services whose git builds cache their layers here."
      icon={Layers}
      title="Used by"
    />
    {#if data.services.length === 0}
      <p class="text-text-subtle p-5 text-sm">
        No service uses this registry yet. Pick it as the build cache on a
        service's Source section.
      </p>
    {:else}
      <ul class="divide-border divide-y">
        {#each data.services as svc (svc.id)}
          <li>
            <a
              class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3"
              href={resolve("/(protected)/services/[serviceId]/environments/source", {
                serviceId: svc.id,
              })}
            >
              <span class="min-w-0 flex-1">
                <span class="text-text block truncate text-sm font-medium">
                  {svc.name}
                </span>
                <span class="text-text-subtle block truncate font-mono text-xs">
                  {svc.slug}
                </span>
              </span>
              <StatusBadge status={svc.currentStatus} />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
