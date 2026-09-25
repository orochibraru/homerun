<script lang="ts">
	import { Check, Zap } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		available: boolean;
		svc: { dnsResolvable: boolean; httpCacheTtl: number | null };
	}

	const { available, svc }: Props = $props();
</script>

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
      <Zap class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">Response cache</p>
      <p class="text-text-muted text-xs">
        Traefik keeps copies of this service's responses and answers repeat
        requests itself, Varnish-style. Each visitor's cookies and credentials
        get their own copies, so one person's pages are never shown to another.
        Responses marked <code>no-store</code> are never cached.
      </p>
    </div>
  </div>

  {#if !available}
    <p class="text-text-muted text-sm">
      An admin turns on <strong>HTTP cache</strong> under Settings → Networking
      first.
    </p>
  {:else}
    <form
      action="?/updateCache"
      class="flex flex-wrap items-end gap-3"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the cache setting.",
        loading: "Saving the cache setting",
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
      <Button type="submit" variant="outline">
        <Check class="size-4" />
        Save
      </Button>
      <p class="text-text-subtle w-full text-xs">
        Blank turns caching off. Only applies to routed domains, and only after
        a redeploy.
      </p>
    </form>
  {/if}
</section>
