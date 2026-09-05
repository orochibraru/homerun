<script lang="ts" module>
	export interface FilterOption {
		label: string;
		value: string;
	}

	export interface FilterGroup {
		key: string;
		label: string;
		options: FilterOption[];
	}
</script>

<script lang="ts">
	import { ListFilter, Search, X } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		Drawer,
		DrawerContent,
		DrawerHeader,
		DrawerTitle,
	} from "$lib/components/ui/drawer/index.js";

	interface Props {
		filters?: FilterGroup[];
		pageParams?: string[];
		placeholder?: string;
		trailing?: Snippet;
	}

	const {
		filters = [],
		pageParams = ["page"],
		placeholder = "Search…",
		trailing,
	}: Props = $props();

	const usableFilters = $derived(filters.filter((f) => f.options.length > 0));

	const currentQuery = $derived(page.url.searchParams.get("q") ?? "");

	const selected = $derived(
		Object.fromEntries(
			usableFilters.map((group) => [
				group.key,
				(page.url.searchParams.get(group.key) ?? "")
					.split(",")
					.map((v) => v.trim())
					.filter(Boolean),
			]),
		),
	);

	const activeCount = $derived(
		Object.values(selected).reduce((total, values) => total + values.length, 0),
	);

	let filtersOpen = $state(false);
	let draft = $state("");
	let debounce: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		draft = currentQuery;
	});

	function apply(mutate: (params: URLSearchParams) => void) {
		const params = new URLSearchParams(page.url.searchParams);
		mutate(params);
		for (const pageParam of pageParams) {
			params.delete(pageParam);
		}
		const query = params.toString();
		void goto(`${page.url.pathname}${query ? `?${query}` : ""}`, {
			keepFocus: true,
			noScroll: true,
			replaceState: true,
		});
	}

	function onSearchInput(value: string) {
		draft = value;
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			apply((params) => {
				if (value.trim()) {
					params.set("q", value.trim());
				} else {
					params.delete("q");
				}
			});
		}, 300);
	}

	function toggle(groupKey: string, value: string) {
		const current = selected[groupKey] ?? [];
		const next = current.includes(value)
			? current.filter((v) => v !== value)
			: [...current, value];
		apply((params) => {
			if (next.length > 0) {
				params.set(groupKey, next.join(","));
			} else {
				params.delete(groupKey);
			}
		});
	}

	function clearFilters() {
		apply((params) => {
			for (const group of usableFilters) {
				params.delete(group.key);
			}
		});
	}
</script>

<div class="mb-6 flex flex-wrap items-center gap-3">
  <div class="relative min-w-52 flex-1">
    <Search class="text-text-subtle absolute top-1/2 left-3 size-4 -translate-y-1/2" />
    <input
      class="glass text-text placeholder:text-text-subtle focus:border-accent w-full rounded-lg py-2 pr-3 pl-9 text-sm focus:outline-none"
      oninput={(e) => onSearchInput(e.currentTarget.value)}
      {placeholder}
      type="search"
      value={draft}
    >
  </div>
  {#if usableFilters.length > 0}
    <Button onclick={() => { filtersOpen = true; }} variant="outline">
      <ListFilter class="size-4" />
      Filters
      {#if activeCount > 0}
        <span class="bg-accent text-accent-foreground rounded-full px-1.5 text-xs">
          {activeCount}
        </span>
      {/if}
    </Button>
  {/if}
  {#if trailing}
    {@render trailing()}
  {/if}
</div>

<Drawer bind:open={filtersOpen} direction="right">
  <DrawerContent class="flex flex-col">
    <DrawerHeader class="flex-row items-center justify-between">
      <DrawerTitle>Filters</DrawerTitle>
      <Button onclick={() => { filtersOpen = false; }} size="icon-sm" variant="ghost">
        <X class="size-4" />
      </Button>
    </DrawerHeader>
    <div class="space-y-6 overflow-y-auto px-4 pb-6">
      {#each usableFilters as group (group.key)}
        <div>
          <h3 class="eyebrow mb-2">{group.label}</h3>
          <div class="flex flex-wrap gap-2">
            {#each group.options as option (option.value)}
              {@const isOn = (selected[group.key] ?? []).includes(option.value)}
              <button
                class="rounded-full border px-3 py-1.5 text-sm capitalize transition-colors {isOn
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border bg-surface text-text-muted hover:bg-surface-2'}"
                onclick={() => toggle(group.key, option.value)}
                type="button"
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    {#if activeCount > 0}
      <div class="border-border border-t px-4 py-3">
        <Button onclick={clearFilters} size="sm" variant="outline">
          Clear all
        </Button>
      </div>
    {/if}
  </DrawerContent>
</Drawer>
