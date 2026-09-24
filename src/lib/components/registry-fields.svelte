<script lang="ts">
	import { ChevronDown, Lock } from "@lucide/svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";

	interface Props {
		class?: string;
		compact?: boolean;
		labelClass: string;
		open?: boolean;
		passwordPlaceholder?: string;
		registryUrl?: string;
		registryUsername?: string;
		urlPlaceholder?: string;
	}

	let {
		class: className = "",
		compact = false,
		labelClass,
		open = $bindable(false),
		passwordPlaceholder,
		registryUrl = $bindable(""),
		registryUsername = $bindable(""),
		urlPlaceholder,
	}: Props = $props();
</script>

<div class={className}>
  <Button
    class={compact
    ? "text-text h-auto w-full justify-start gap-3 px-4 py-3 font-normal"
    : "h-auto w-full items-center justify-start gap-3 px-5 py-4 font-normal"}
    onclick={() => {
      open = !open;
    }}
    variant="ghost"
  >
    {#if compact}
      <Lock class="text-text-muted size-4" />
      <span class="text-text flex-1 text-sm font-medium">
        Private registry
      </span>
    {:else}
      <div class="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
        <Lock class="size-4" />
      </div>
      <div class="flex-1 text-left">
        <h2 class="eyebrow">Private registry</h2>
        <p class="text-xs text-text-muted">
          Only needed for non-public images.
        </p>
      </div>
    {/if}
    <ChevronDown
      class="
        size-4 text-text-muted transition-transform {open
        ? 'rotate-180'
        : ''}
     "
    />
  </Button>

  {#if open}
    <div class="space-y-4 border-t border-border {compact ? 'p-4' : 'p-5'}">
      <div>
        <label class={labelClass} for="registryUrl">Registry URL</label>
        <Input
          id="registryUrl"
          name="registryUrl"
          placeholder={urlPlaceholder}
          type="text"
          bind:value={registryUrl}
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class={labelClass} for="registryUsername">Username</label>
          <Input
            id="registryUsername"
            name="registryUsername"
            type="text"
            bind:value={registryUsername}
          />
        </div>
        <div>
          <label class={labelClass} for="registryPassword">
            Password / token
          </label>
          <Input
            id="registryPassword"
            name="registryPassword"
            placeholder={passwordPlaceholder}
            type="password"
          />
        </div>
      </div>
    </div>
  {/if}
</div>
