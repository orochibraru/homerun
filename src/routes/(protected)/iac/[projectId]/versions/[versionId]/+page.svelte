<script lang="ts">
	import { ArrowLeft } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() =>
		title.set(
			`Infrastructure as Code · ${data.project.name} · ${data.diff.serial}`,
		),
	);

	const groups = $derived([
		{
			addresses: data.diff.diff.added,
			label: "Added",
			tone: "text-green-600 dark:text-green-400",
		},
		{
			addresses: data.diff.diff.changed,
			label: "Changed",
			tone: "text-amber-600 dark:text-amber-400",
		},
		{
			addresses: data.diff.diff.removed,
			label: "Removed",
			tone: "text-red-600 dark:text-red-400",
		},
	]);
	const untouched = $derived(
		groups.every((group) => group.addresses.length === 0),
	);
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/iac/[projectId]", {
      projectId: data.project.id,
    })}
  >
    <ArrowLeft class="size-4" />
    {data.project.name}
  </a>

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Serial {data.diff.serial}</h2>
      <p class="text-text-muted text-xs">
        {data.diff.previousSerial === null
          ? "The first version: everything in it is new."
          : `Compared with serial ${data.diff.previousSerial}, the version before it.`}
      </p>
    </div>
    {#if untouched}
      <p class="text-text-muted px-5 py-4 text-sm">
        No resource changed: only outputs or metadata did.
      </p>
    {:else}
      <div class="grid gap-5 px-5 py-4 md:grid-cols-3">
        {#each groups as group (group.label)}
          <div>
            <h3 class="text-sm font-medium {group.tone}">
              {group.label} ({group.addresses.length})
            </h3>
            {#if group.addresses.length > 0}
              <ul class="mt-2 space-y-1">
                {#each group.addresses as address (address)}
                  <li class="text-text font-mono text-xs break-all">{address}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
