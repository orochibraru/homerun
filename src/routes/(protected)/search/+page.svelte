<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { ChevronRight, FileText, Search, X } from "@lucide/svelte";
	import { onMount } from "svelte";

	import { SEARCH_KIND_ICONS } from "#lib/components/search-kind-icons.js";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { searchContent } from "#lib/remote/search.remote.js";
	import {
		filterPages,
		SEARCH_MAX_LENGTH,
		SEARCH_MIN_LENGTH,
		SEARCH_PAGES,
		type SearchGroup,
	} from "#lib/search.js";
	import { title } from "#lib/store/title.js";

	const { data } = $props();

	const DEBOUNCE_MS = 250;

	let search = $state(page.url.searchParams.get("q") ?? "");
	let input = $state<HTMLInputElement | null>(null);
	let debounced = $state("");

	const term = $derived(search.trim());
	const pages = $derived(filterPages(SEARCH_PAGES, term, data.permissions));

	onMount(() => {
		title.set("Search");
		input?.focus();
	});

	$effect(() => {
		const q = term;
		const timer = setTimeout(() => {
			const url = new URL(page.url.href);
			if (q) {
				url.searchParams.set("q", q);
			} else {
				url.searchParams.delete("q");
			}
			if (url.search !== page.url.search) {
				void goto(url, { replace: true, reset: false });
			}
			debounced = q.slice(0, SEARCH_MAX_LENGTH);
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});

	const contentPromise = $derived<Promise<SearchGroup[]> | null>(
		debounced.length >= SEARCH_MIN_LENGTH ? searchContent(debounced) : null,
	);

	const rowClass =
		"border-border bg-surface active:bg-surface-2 hover:bg-surface-2 flex min-h-14 items-center gap-3 rounded-xl border px-2 py-1.5 transition-colors";
	const tileClass =
		"bg-accent-light text-accent flex size-9 shrink-0 items-center justify-center rounded-lg";
</script>

<div class="p-5 md:p-6">
	<div class="relative">
		<Search
			class="text-text-muted pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2"
		/>
		<Input
			bind:ref={input}
			class="h-12 rounded-2xl pr-12 pl-11 text-base [&::-webkit-search-cancel-button]:appearance-none"
			aria-label="Search"
			autocomplete="off"
			enterkeyhint="search"
			maxlength={SEARCH_MAX_LENGTH}
			placeholder="Pages, services, stacks, templates…"
			type="search"
			bind:value={search}
		/>
		{#if search}
			<button
				class="text-text-muted absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full"
				aria-label="Clear"
				onclick={() => {
					search = "";
					input?.focus();
				}}
				type="button"
			>
				<X class="size-4" />
			</button>
		{/if}
	</div>

	<div class="mt-5 space-y-6">
		{#if pages.length > 0}
			<section>
				<h2 class="text-text-subtle mb-2 px-1 text-xs font-medium">Pages</h2>
				<div class="flex flex-col gap-1.5">
					{#each pages.slice(0, term ? 8 : pages.length) as p (p.href)}
						<a class={rowClass} href={p.href}>
							<span class={tileClass}><FileText class="size-4.5" /></span>
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="text-text truncate text-sm font-medium"
									>{p.label}</span
								>
								<span class="text-text-subtle truncate text-[0.6875rem]"
									>{p.section}</span
								>
							</span>
							<ChevronRight class="text-text-subtle size-4 shrink-0" />
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if contentPromise}
			{#await contentPromise}
				<div class="space-y-1.5">
					<Skeleton class="h-14 rounded-xl" />
					<Skeleton class="h-14 rounded-xl" />
					<Skeleton class="h-14 rounded-xl" />
				</div>
			{:then groups}
				{#each groups as group (group.kind)}
					{@const KindIcon = SEARCH_KIND_ICONS[group.kind]}
					<section>
						<h2 class="text-text-subtle mb-2 px-1 text-xs font-medium">
							{group.heading}
						</h2>
						<div class="flex flex-col gap-1.5">
							{#each group.results as result (result.id)}
								<a class={rowClass} href={result.href}>
									<span class={tileClass}><KindIcon class="size-4.5" /></span>
									<span class="flex min-w-0 flex-1 flex-col">
										<span class="text-text truncate text-sm font-medium"
											>{result.label}</span
										>
										{#if result.detail}
											<span class="text-text-subtle truncate text-[0.6875rem]"
												>{result.detail}</span
											>
										{/if}
									</span>
									<ChevronRight class="text-text-subtle size-4 shrink-0" />
								</a>
							{/each}
						</div>
					</section>
				{/each}
				{#if groups.length === 0 && pages.length === 0}
					<p class="text-text-muted py-10 text-center text-sm">
						No results for “{term}”.
					</p>
				{/if}
			{:catch}
				<p class="py-6 text-center text-sm text-red-600 dark:text-red-400">
					Search failed. Try again.
				</p>
			{/await}
		{:else if term && pages.length === 0}
			<p class="text-text-muted py-10 text-center text-sm">
				No pages match “{term}”.
			</p>
		{/if}
	</div>
</div>
