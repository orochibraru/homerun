<script lang="ts">
	import { Zap } from "@lucide/svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	interface Props {
		available: boolean;
		svc: { dnsResolvable: boolean; httpCacheTtl: number | null };
	}

	const { available, svc }: Props = $props();

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
  <PanelHeader icon={Zap} title="Response cache">
    {#snippet description()}
      Traefik keeps copies of this service's responses and answers repeat
      requests itself, Varnish-style. Each visitor's cookies and credentials
      get their own copies, so one person's pages are never shown to another.
      Responses marked <code>no-store</code> are never cached.
    {/snippet}
    {#snippet trailing()}
      {#if available}
        <SaveButton form="service-cache" pending={submitting} />
      {/if}
    {/snippet}
  </PanelHeader>

  {#if !available}
    <p class="text-text-muted p-5 text-sm">
      An admin turns on <strong>HTTP cache</strong> under Settings → Networking
      first.
    </p>
  {:else}
    <form
      id="service-cache"
      action="?/updateCache"
      class="space-y-1.5 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the cache setting.",
        loading: "Saving the cache setting",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Saved. Redeploy for it to take effect.",
      })}
    >
      <div>
        <label class={label} for="httpCacheTtl">Cache for (seconds)</label>
        <Input
          class="w-40"
          id="httpCacheTtl"
          max="86400"
          min="1"
          name="httpCacheTtl"
          placeholder="Off"
          type="number"
          value={svc.httpCacheTtl ?? ""}
        />
      </div>
      <p class="text-text-subtle text-xs">
        Blank turns caching off. Only applies to routed domains, and only after
        a redeploy.
      </p>
    </form>
  {/if}
</section>
