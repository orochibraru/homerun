<script lang="ts">
	import { Check, Copy, Database } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import {
		buildLinkUrl,
		detectLinkEngine,
		type LinkTargetService,
	} from "$lib/service-link";

	const { service }: { service: LinkTargetService } = $props();

	const engine = $derived(detectLinkEngine(service.image));

	const rows = $derived.by(() => {
		if (engine.id === "generic") {
			return [];
		}
		const entries = [
			{ label: "Connection URL", value: buildLinkUrl(engine, service, "url") },
		];
		if (engine.supportsJdbc) {
			entries.push({
				label: "JDBC URL",
				value: buildLinkUrl(engine, service, "jdbc"),
			});
		}
		return entries;
	});

	let copied = $state<string | null>(null);

	function copy(value: string) {
		void navigator.clipboard.writeText(value);
		copied = value;
		toast.success("Copied to clipboard.");
		setTimeout(() => {
			if (copied === value) {
				copied = null;
			}
		}, 1500);
	}
</script>

{#if rows.length > 0}
  <section class="panel rounded-xl">
    <div class="panel-head">
      <h2 class="eyebrow flex items-center gap-1.5">
        <Database class="size-3" />
        {engine.label} connection
      </h2>
      <span class="text-text-subtle text-[0.6875rem]">
        Reachable from other services in this project
      </span>
    </div>
    <div class="divide-border divide-y">
      {#each rows as row (row.label)}
        <div class="flex items-center gap-3 px-4 py-2.5">
          <span class="text-text-subtle w-28 shrink-0 text-xs">{row.label}</span>
          <code class="text-text min-w-0 flex-1 truncate font-mono text-xs">
            {row.value}
          </code>
          <button
            aria-label="Copy {row.label}"
            class="text-text-subtle hover:bg-surface-2 hover:text-text shrink-0 rounded-md p-1.5 transition-colors"
            onclick={() => copy(row.value)}
            type="button"
          >
            {#if copied === row.value}
              <Check class="size-3.5 text-emerald-500" />
            {:else}
              <Copy class="size-3.5" />
            {/if}
          </button>
        </div>
      {/each}
    </div>
  </section>
{/if}
