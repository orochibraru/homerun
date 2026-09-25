<script lang="ts">
	import { ExternalLink, LockKeyhole } from "@lucide/svelte";
	import { resolve } from "$app/paths";

	const { data } = $props();
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Protected apps</h2>
      <p class="text-text-muted text-xs">
        Services with "Require login" turned on. Which methods each one accepts,
        and who's allowed through, is configured on that service's Security
        tab.
      </p>
    </div>
    {#if data.gatedServices.length === 0}
      <p class="text-text-muted p-5 text-sm">
        No app is behind the login wall yet. Turn on "Require login" on a
        service's Security tab to add one.
      </p>
    {:else}
      <div class="divide-border divide-y">
        {#each data.gatedServices as svc (svc.id)}
          <a
            class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3"
            href="{resolve('/services')}/{svc.id}/security"
          >
            <LockKeyhole class="text-accent size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-text truncate text-sm font-medium">{svc.name}</p>
              <p class="text-text-subtle truncate text-xs">
                {#if svc.methods.length === 0}
                  no sign-in method picked yet : nobody can get in
                {:else}
                  {svc.methods.join(", ")}
                {/if}
              </p>
            </div>
            <ExternalLink class="text-text-subtle size-3.5 shrink-0" />
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>
