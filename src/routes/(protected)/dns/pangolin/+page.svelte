<script lang="ts">
	import { Globe } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { enhanceToast } from "$lib/toast";
	import PangolinSection from "./pangolin-section.svelte";

	const { data } = $props();

	let form = $state<HTMLFormElement | undefined>();
</script>

<div class="space-y-6">
  <form
    action="?/setEnabled"
    method="POST"
    bind:this={form}
    use:enhance={enhanceToast({
      error: "Couldn't change Pangolin.",
      loading: "Saving",
      success: (result) =>
        result && "enabled" in result && result.enabled ? "Pangolin is on." : "Pangolin is off.",
    })}
  >
    <CheckBox
      checked={data.enabled}
      helperText="Publish every routed service through a self-hosted Pangolin tunnel instead of pointing DNS at this server. Your domains' records under Domains keep being managed either way."
      id="pangolinEnabled"
      label="Use Pangolin"
      name="enabled"
      onCheckedChange={() => {
        void Promise.resolve().then(() => form?.requestSubmit());
      }}
    />
  </form>

  {#if data.enabled}
    <section class="panel rounded-md">
      <div class="border-border border-b px-5 py-4">
        <h2 class="eyebrow">Pangolin domains</h2>
        <p class="text-text-muted text-xs">
          The domains registered to your Pangolin org. A service's domain has to
          sit under one of these for Homerun to publish it.
        </p>
      </div>
      <div class="p-5">
        {#await data.domains}
          <Skeleton class="h-6 w-64" />
        {:then result}
          {#if result.error}
            <p class="text-text-muted text-sm">{result.error}</p>
          {:else if result.domains.length === 0}
            <p class="text-text-muted text-sm">No domains found.</p>
          {:else}
            <ul class="flex flex-wrap gap-2">
              {#each result.domains as domain (domain)}
                <li class="border-border flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs">
                  <Globe class="text-accent size-3.5" />
                  {domain}
                </li>
              {/each}
            </ul>
          {/if}
        {/await}
      </div>
    </section>
    <PangolinSection settings={data.settings} />
  {/if}
</div>
