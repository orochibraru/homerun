<script lang="ts">
	import { KeyRound } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";

	const { data } = $props();
</script>

<section class="mb-8">
  <header class="mb-3 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="text-text text-sm font-medium">Stored credentials</h2>
      <p class="text-text-muted mt-0.5 text-sm">
        Credentials for registries Homerun talks to: pushing build cache, and
        pulling private images during a build.
      </p>
    </div>
    <Button href={resolve("/(protected)/build-cache-registries/new")} variant="outline">
      Add credentials
    </Button>
  </header>

  {#if data.registries.length === 0}
    <EmptyState
      icon={KeyRound}
      subtitle="Add one to push build cache to a registry, or to pull from a private one."
      title="No stored credentials"
    />
  {:else}
    <ul
      class="border-border bg-surface-1 divide-border divide-y rounded-lg border"
    >
      {#each data.registries as registry (registry.id)}
        <li class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <p class="text-text text-sm font-medium">{registry.name}</p>
            <p class="text-text-muted mt-0.5 font-mono text-xs break-all">
              {registry.username}@{registry.registryUrl}
            </p>
          </div>
          <Button
            href={resolve("/(protected)/build-cache-registries/[registryId]", {
              registryId: registry.id,
            })}
            size="sm"
            variant="ghost"
          >
            Edit
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section>
  <h2 class="text-text text-sm font-medium">Services with their own pull credentials</h2>
  <p class="text-text-muted mt-0.5 mb-3 text-sm">
    Set on the service itself, on its Source tab, and used only for that
    service's own image.
  </p>
  {#if data.servicesWithOwnCredentials.length === 0}
    <p class="text-text-muted text-sm">None : every service pulls anonymously.</p>
  {:else}
    <ul
      class="border-border bg-surface-1 divide-border divide-y rounded-lg border"
    >
      {#each data.servicesWithOwnCredentials as svc (svc.id)}
        <li class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <p class="text-text text-sm font-medium">{svc.name}</p>
            <p class="text-text-muted mt-0.5 font-mono text-xs break-all">
              {svc.username}@{svc.registryUrl}
            </p>
          </div>
          <Button
            href={resolve("/(protected)/services/[serviceId]/source", {
              serviceId: svc.id,
            })}
            size="sm"
            variant="ghost"
          >
            Open
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
