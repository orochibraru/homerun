<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { ChevronLeft } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import * as Select from "@zedensix/ui/select";
	import { onMount } from "svelte";

	import { labelClass } from "#lib/components/form-styles.js";
	import LogHistoryView from "#lib/components/log-history-view.svelte";
	import { title } from "#lib/store/title.js";

	const { data } = $props();

	onMount(() => title.set(`${data.system} · Log history`));

	const systems = $derived(
		data.systems.includes(data.system)
			? data.systems
			: [data.system, ...data.systems],
	);

	/** Opens another container's history, keeping no filter of this one. */
	function open(system: string) {
		if (system !== data.system) {
			void goto(
				resolve("/(protected)/system-logs/history/[system]", { system }),
			);
		}
	}
</script>

<div class="p-5 md:p-6">
	<div class="mb-6 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-text text-lg font-semibold tracking-tight">
				{data.system}
			</h1>
			<p class="text-text-muted mt-1 text-sm">
				One of this instance's own containers, by the name its history is kept
				under.
			</p>
		</div>
		<Button href={resolve("system-logs")} size="sm" variant="outline">
			<ChevronLeft class="size-3.5" />
			System Logs
		</Button>
	</div>

	<LogHistoryView
		description="Every line this container wrote, across restarts and recreates."
		downloadHref={resolve(
			"/(protected)/system-logs/history/[system]/download",
			{
				system: data.system,
			},
		)}
		history={data.history}
		instanceLabel="Container"
	>
		{#snippet picker()}
			<label class={labelClass} for="log-system">Container</label>
			<Select.Root type="single" value={data.system} onValueChange={open}>
				<Select.Trigger id="log-system" class="w-full md:w-80">
					<span class="truncate">{data.system}</span>
				</Select.Trigger>
				<Select.Content>
					{#each systems as name (name)}
						<Select.Item label={name} value={name} />
					{/each}
				</Select.Content>
			</Select.Root>
		{/snippet}
	</LogHistoryView>
</div>
