<script lang="ts">
	import { FileText, Search } from "@lucide/svelte";
	import { headerControlClass } from "#lib/components/header-styles.js";
	import { SEARCH_KIND_ICONS as KIND_ICONS } from "#lib/components/search-kind-icons.js";
	import * as Command from "#lib/components/ui/command/index.js";
	import type { Permissions } from "#lib/permissions.js";
	import { searchContent } from "#lib/remote/search.remote.js";
	import {
		filterPages,
		SEARCH_MAX_LENGTH,
		SEARCH_MIN_LENGTH,
		SEARCH_PAGES,
		type SearchGroup,
	} from "#lib/search.js";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { permissions }: { permissions: Permissions } = $props();

	const DEBOUNCE_MS = 250;

	let open = $state(false);
	let search = $state("");
	let contentPromise = $state<Promise<SearchGroup[]> | null>(null);

	const term = $derived(search.trim());
	const pages = $derived(filterPages(SEARCH_PAGES, term, permissions));

	$effect(() => {
		const q = term;
		if (q.length < SEARCH_MIN_LENGTH) {
			contentPromise = null;
			return;
		}
		const timer = setTimeout(() => {
			contentPromise = searchContent(q.slice(0, SEARCH_MAX_LENGTH));
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});

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

<a aria-label="Search" class="{headerControlClass} w-10 md:hidden" href={resolve("search")}>
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
  <kbd class="text-text-subtle hidden font-sans text-[0.6875rem] tracking-widest sm:inline">⌘K</kbd>
</button>

<Command.Dialog
  bind:open
  class="sm:max-w-2xl"
  description="Search pages, services, stacks, templates and more"
  shouldFilter={false}
  title="Search"
>
  <Command.Input bind:value={search} placeholder="Search pages and content…" />
  <Command.List class="max-h-[min(28rem,60vh)]">
    {#if pages.length > 0}
      <Command.Group heading="Pages">
        {#each pages.slice(0, term ? 8 : pages.length) as p (p.href)}
          <Command.Item onSelect={() => navigate(p.href)} value={`page:${p.href}`}>
            <FileText class="text-text-muted" />
            <span class="truncate">{p.label}</span>
            <span class="text-text-subtle ml-auto shrink-0 text-xs">{p.section}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}

    {#if contentPromise}
      {#await contentPromise}
        <Command.Loading>
          <p class="text-text-muted px-2 py-3 text-xs">Searching…</p>
        </Command.Loading>
      {:then groups}
        {#each groups as group (group.kind)}
          {@const KindIcon = KIND_ICONS[group.kind]}
          <Command.Group heading={group.heading}>
            {#each group.results as result (result.id)}
              <Command.Item
                onSelect={() => navigate(result.href)}
                value={`${result.kind}:${result.id}`}
              >
                <KindIcon class="text-text-muted" />
                <span class="truncate">{result.label}</span>
                {#if result.detail}
                  <span class="text-text-subtle ml-auto max-w-[50%] truncate text-xs">{result.detail}</span>
                {/if}
              </Command.Item>
            {/each}
          </Command.Group>
        {/each}
        {#if groups.length === 0 && pages.length === 0}
          <p class="text-text-muted px-2 py-6 text-center text-sm">No results for “{term}”.</p>
        {/if}
      {:catch}
        <p class="px-2 py-3 text-xs text-red-600 dark:text-red-400">Search failed. Try again.</p>
      {/await}
    {:else if term && pages.length === 0}
      <p class="text-text-muted px-2 py-6 text-center text-sm">No pages match “{term}”.</p>
    {/if}
  </Command.List>
</Command.Dialog>
