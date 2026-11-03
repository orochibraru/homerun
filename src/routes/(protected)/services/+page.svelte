<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { Plus, Upload } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { onMount } from "svelte";

	import Skeleton from "#lib/components/skeleton.svelte";
	import { title } from "#lib/store/title.js";
	import { Streamed } from "#lib/streamed.svelte.js";

	import ServicesList from "./services-list.svelte";

	const { data } = $props();

	const facets = new Streamed(
		() => `services:facets:${data.user.id}`,
		() => data.facets,
	);
	const listing = new Streamed(
		() => `services:${data.user.id}:${page.url.search}`,
		() => data.listing,
	);

	onMount(() => title.set("Services"));
</script>

<div class="p-5 md:p-6">
	<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
		<div class="flex min-w-0 items-baseline gap-2.5">
			<h1 class="text-text text-lg font-semibold tracking-tight max-md:hidden">
				Services
			</h1>
			{#if facets.current}
				<p class="text-text-subtle text-sm">
					{[
						`${facets.current.total} ${facets.current.total === 1 ? "service" : "services"}`,
						facets.current.stackCount > 0 &&
							`in ${facets.current.stackCount} ${facets.current.stackCount === 1 ? "stack" : "stacks"}`,
					]
						.filter(Boolean)
						.join(" ")}
				</p>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<Button href={resolve("services/import")} variant="outline"
				><Upload class="size-4" />Import compose</Button
			>

			<Button href={resolve("services/new")}
				><Plus class="size-4" />Deploy</Button
			>
		</div>
	</div>

	{#if listing.current}
		<ServicesList
			facets={facets.current}
			filtered={data.filtered}
			listing={listing.current}
			page={data.page}
			perPage={data.perPage}
			serviceDomain={data.serviceDomain}
			view={data.view}
		/>
	{:else if listing.failed}
		<div
			class="border-border/70 text-text-muted rounded-md border border-dashed py-16 text-center text-sm"
		>
			Couldn't load the services.
		</div>
	{:else}
		<div aria-busy="true" class="space-y-3">
			<Skeleton class="h-9 w-full" />
			{#each { length: data.treeView ? 4 : 6 }, i (i)}
				<Skeleton class="h-14 w-full" />
			{/each}
		</div>
	{/if}
</div>
