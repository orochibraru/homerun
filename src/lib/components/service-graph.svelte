<script lang="ts">
	import { ArrowRight, Server } from "@lucide/svelte";
	import { resolve } from "$app/paths";

	interface Node {
		id: string;
		name: string;
		slug: string;
	}

	interface Props {
		dependsOn: Node[];
		name: string;
		usedBy: Node[];
	}

	const { name, dependsOn, usedBy }: Props = $props();
</script>

{#snippet node(item: Node)}
  <a
    class="border-border bg-surface-2 hover:border-accent/50 flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors"
    href="{resolve('/services')}/{item.id}"
  >
    <Server class="text-text-subtle size-3.5 shrink-0" />
    <span class="min-w-0">
      <span class="text-text block truncate text-xs font-medium">{item.name}</span>
      <span class="text-text-subtle block truncate text-[0.6875rem]">{item.slug}</span>
    </span>
  </a>
{/snippet}

<section class="panel rounded-xl">
  <div class="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
    <h2 class="eyebrow">Connections</h2>
    <span class="text-text-subtle text-[0.6875rem]">
      Derived from environment variables pointing at another service's slug
    </span>
  </div>

  {#if dependsOn.length === 0 && usedBy.length === 0}
    <p class="text-text-muted px-4 py-6 text-center text-xs">
      Nothing links to this service, and it references nothing else.
    </p>
  {:else}
    <div class="grid items-center gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div class="space-y-2">
        {#if dependsOn.length > 0}
          <p class="text-text-subtle text-[0.6875rem] font-medium">Needs</p>
          {#each dependsOn as item (item.id)}
            {@render node(item)}
          {/each}
        {/if}
      </div>

      <ArrowRight
        class="text-text-subtle mx-auto size-4 {dependsOn.length === 0
        ? 'invisible'
        : ''} hidden md:block"
      />

      <div class="border-accent/50 bg-accent-light rounded-lg border px-3 py-2.5">
        <p class="text-text truncate text-xs font-semibold">{name}</p>
        <p class="text-accent text-[0.6875rem]">this service</p>
      </div>

      <ArrowRight
        class="text-text-subtle mx-auto size-4 {usedBy.length === 0
        ? 'invisible'
        : ''} hidden md:block"
      />

      <div class="space-y-2">
        {#if usedBy.length > 0}
          <p class="text-text-subtle text-[0.6875rem] font-medium">Used by</p>
          {#each usedBy as item (item.id)}
            {@render node(item)}
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</section>
