<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { CornerDownLeft, FileText, Search } from "@lucide/svelte";
	import * as Command from "@orochibraru/ui/command";
	import type { Component } from "svelte";

	import { headerControlClass } from "#lib/components/header-styles.js";
	import { SEARCH_KIND_ICONS as KIND_ICONS } from "#lib/components/search-kind-icons.js";
	import type { Permissions } from "#lib/permissions.js";
	import { searchContent } from "#lib/remote/search.remote.js";
	import {
		filterPages,
		SEARCH_MAX_LENGTH,
		SEARCH_MIN_LENGTH,
		SEARCH_PAGES,
		type SearchGroup,
	} from "#lib/search.js";

	const {
		navItems = [],
		permissions,
	}: {
		navItems?: { href: string; icon: Component }[];
		permissions: Permissions;
	} = $props();

	const DEBOUNCE_MS = 250;

	let open = $state(false);
	let search = $state("");
	let debounced = $state("");

	const term = $derived(search.trim());
	const pages = $derived(filterPages(SEARCH_PAGES, term, permissions));
	const sections = $derived(
		[...new Set(pages.map((page) => page.section))].map((section) => ({
			pages: pages.filter((page) => page.section === section),
			section,
		})),
	);

	/** The sidebar icon of the nav item whose href is the longest prefix of `href`, or a page icon when none matches. */
	function pageIcon(href: string): Component {
		let best: { href: string; icon: Component } | null = null;
		for (const item of navItems) {
			const matches =
				item.href === "/"
					? href === "/"
					: href === item.href || href.startsWith(`${item.href}/`);
			if (matches && (!best || item.href.length > best.href.length)) {
				best = item;
			}
		}
		return best?.icon ?? FileText;
	}

	$effect(() => {
		const q = term;
		const timer = setTimeout(() => {
			debounced = q.slice(0, SEARCH_MAX_LENGTH);
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});

	const contentPromise = $derived<Promise<SearchGroup[]> | null>(
		debounced.length >= SEARCH_MIN_LENGTH ? searchContent(debounced) : null,
	);

	function isTyping(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLElement &&
			(target.isContentEditable || target.matches("input, textarea, select"))
		);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (
			event.key.toLowerCase() === "k" &&
			(event.metaKey || event.ctrlKey) &&
			(open || !isTyping(event.target))
		) {
			event.preventDefault();
			open = !open;
		}
	}

	function navigate(href: string) {
		open = false;
		search = "";
		void goto(href);
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<a
	aria-label="Search"
	class="{headerControlClass} w-10 md:hidden"
	href={resolve("search")}
>
	<Search class="size-4" />
</a>

<button
	class="{headerControlClass} px-2.5 max-md:hidden"
	aria-label="Search"
	onclick={() => {
		open = true;
	}}
	type="button"
>
	<Search class="size-3.5" />
	<span class="hidden sm:inline">Search…</span>
	<kbd
		class="text-text-subtle hidden font-sans text-[0.6875rem] tracking-widest sm:inline"
		>⌘K</kbd
	>
</button>

{#snippet row(Icon: Component, label: string, detail: string | null)}
	<span
		class="bg-surface-2 text-text-muted group-data-selected/command-item:bg-accent/10 group-data-selected/command-item:text-accent flex size-7 shrink-0 items-center justify-center rounded-md"
	>
		<Icon class="size-3.5" />
	</span>
	<span class="truncate">{label}</span>
	{#if detail}
		<Command.Shortcut
			class="text-text-subtle max-w-[45%] truncate tracking-normal"
		>
			{detail}
		</Command.Shortcut>
	{/if}
{/snippet}

<Command.Dialog
	bind:open
	class="sm:max-w-2xl **:data-[slot=command-input-wrapper]:border-border **:data-[slot=command-input-wrapper]:border-b **:data-[slot=command-input-wrapper]:p-2 **:data-[slot=input-group]:h-11! **:data-[slot=input-group]:border-0! **:data-[slot=input-group]:bg-transparent! **:data-[slot=input-group]:ring-0! **:data-[slot=command-input]:text-base"
	description="Search pages, services, stacks, templates and more"
	shouldFilter={false}
	title="Search"
>
	<Command.Input bind:value={search} placeholder="Search pages and content…" />
	<Command.List class="max-h-[min(30rem,60vh)] p-1.5">
		{#if term && pages.length > 0}
			<Command.Group heading="Pages">
				{#each pages.slice(0, 8) as page (page.href)}
					<Command.Item
						class="py-1.5"
						onSelect={() => navigate(page.href)}
						value={`page:${page.href}`}
					>
						{@render row(pageIcon(page.href), page.label, page.section)}
					</Command.Item>
				{/each}
			</Command.Group>
		{:else if !term}
			{#each sections as { pages: sectionPages, section } (section)}
				<Command.Group heading={section}>
					{#each sectionPages as page (page.href)}
						<Command.Item
							class="py-1.5"
							onSelect={() => navigate(page.href)}
							value={`page:${page.href}`}
						>
							{@render row(pageIcon(page.href), page.label, null)}
						</Command.Item>
					{/each}
				</Command.Group>
			{/each}
		{/if}

		{#if contentPromise}
			{#await contentPromise}
				<Command.Loading>
					<p class="text-text-muted px-2 py-3 text-xs">Searching…</p>
				</Command.Loading>
			{:then groups}
				{#each groups as group (group.kind)}
					<Command.Group heading={group.heading}>
						{#each group.results as result (result.id)}
							<Command.Item
								class="py-1.5"
								onSelect={() => navigate(result.href)}
								value={`${result.kind}:${result.id}`}
							>
								{@render row(
									KIND_ICONS[group.kind],
									result.label,
									result.detail ?? null,
								)}
							</Command.Item>
						{/each}
					</Command.Group>
				{/each}
				{#if groups.length === 0 && pages.length === 0}
					<p class="text-text-muted px-2 py-8 text-center text-sm">
						No results for “{term}”.
					</p>
				{/if}
			{:catch}
				<p class="px-2 py-3 text-xs text-red-600 dark:text-red-400">
					Search failed. Try again.
				</p>
			{/await}
		{:else if term && pages.length === 0}
			<p class="text-text-muted px-2 py-8 text-center text-sm">
				No pages match “{term}”.
			</p>
		{/if}
	</Command.List>
	<div
		class="border-border text-text-subtle flex items-center gap-4 border-t px-4 py-2 text-[0.6875rem]"
	>
		<span class="inline-flex items-center gap-1.5">
			<kbd class="border-border rounded border px-1 font-sans">↑↓</kbd>
			Navigate
		</span>
		<span class="inline-flex items-center gap-1.5">
			<kbd class="border-border rounded border px-1 font-sans">
				<CornerDownLeft class="size-2.5" />
			</kbd>
			Open
		</span>
		<span class="inline-flex items-center gap-1.5">
			<kbd class="border-border rounded border px-1 font-sans">Esc</kbd>
			Close
		</span>
	</div>
</Command.Dialog>
