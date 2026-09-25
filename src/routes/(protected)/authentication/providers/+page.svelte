<script lang="ts">
	import { ExternalLink, KeyRound, Plus } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";

	const { data } = $props();
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <div class="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
      <div>
        <h2 class="eyebrow">OAuth / OIDC providers</h2>
        <p class="text-text-muted text-xs">
          Single sign-on for the dashboard, and selectable per app for the login
          wall.
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <span class="text-text-subtle text-xs">
          {data.providers.length} configured
        </span>
        <Button href={resolve("/authentication/new")} size="sm">
          <Plus class="size-4" />
          Add provider
        </Button>
      </div>
    </div>

    {#if data.providers.length === 0}
      <div class="p-5">
        <EmptyState
          icon={KeyRound}
          subtitle="Add one to offer single sign-on alongside email and password."
          title="No providers yet"
        >
          <Button href={resolve("/authentication/new")}>
            <Plus class="size-4" />
            Add provider
          </Button>
        </EmptyState>
      </div>
    {:else}
      <div class="divide-border divide-y">
        {#each data.providers as provider (provider.name)}
          <a
            class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3"
            href="{resolve('/authentication')}/{provider.name}"
          >
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-lg {provider.enabled
              ? 'bg-accent/10 text-accent'
              : 'bg-surface-3 text-text-subtle'}"
            >
              <KeyRound class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2">
                <span class="text-text text-sm font-semibold">{provider.label}</span>
                <span class="text-text-subtle text-xs">{provider.name}</span>
                {#if !provider.enabled}
                  <span
                    class="border-border text-text-subtle rounded-md border px-1.5 py-0.5 text-[0.6rem] tracking-wider uppercase"
                  >
                    disabled
                  </span>
                {/if}
              </div>
              <p class="text-text-subtle mt-0.5 truncate text-xs">
                {provider.discoveryUrl}
              </p>
            </div>
            {#if provider.usedBy > 0}
              <span class="text-text-subtle shrink-0 text-xs">
                {provider.usedBy} app{provider.usedBy === 1 ? "" : "s"}
              </span>
            {/if}
            <ExternalLink class="text-text-subtle size-3.5 shrink-0" />
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>
