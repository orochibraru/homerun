<script lang="ts">
	import { Database } from "@lucide/svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
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
</script>

{#if rows.length > 0}
  <section class="panel rounded-xl">
    <div class="panel-head">
      <h2 class="eyebrow flex items-center gap-1.5">
        <Database class="size-3" />
        {engine.label} connection
      </h2>
      <span class="text-text-subtle text-[0.6875rem]">
        Reachable from other services in this stack
      </span>
    </div>
    <div class="divide-border divide-y">
      {#each rows as row (row.label)}
        <div class="flex items-center gap-3 px-4 py-2.5">
          <span class="text-text-subtle w-28 shrink-0 text-xs">{row.label}</span>
          <CopyBox
            class="min-w-0 flex-1 border-transparent bg-transparent py-0 pl-0"
            label={row.label}
            truncate
            value={row.value}
          />
        </div>
      {/each}
    </div>
  </section>
{/if}
