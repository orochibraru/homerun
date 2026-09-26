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
	import { ArrowDownUp, ListFilter, Search, X } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import type { SortOption } from "$lib/list-sorts";
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
		sorts?: SortOption[];
		trailing?: Snippet;
	}

	const {
		filters = [],
		pageParams = ["page"],
		placeholder = "Search…",
		sorts = [],
		trailing,
	}: Props = $props();

	const currentSort = $derived(page.url.searchParams.get("sort") ?? "");
	const sortLabel = $derived(
		sorts.find((option) => option.value === currentSort)?.label ??
			"Default order",
	);

	function setSort(value: string) {
		apply((params) => {
			if (value) {
				params.set("sort", value);
			} else {
				params.delete("sort");
			}
		});
	}

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
      class="panel text-text placeholder:text-text-subtle focus:border-accent w-full rounded-lg py-2 pr-3 pl-9 text-sm focus:outline-none"
      oninput={(e) => onSearchInput(e.currentTarget.value)}
      {placeholder}
      type="search"
      value={draft}
    >
  </div>
  {#if sorts.length > 0}
    <SelectRoot onValueChange={setSort} type="single" value={currentSort}>
      <SelectTrigger class="w-48" aria-label="Sort">
        <ArrowDownUp class="mr-1.5 inline size-4 align-text-bottom" />{sortLabel}
      </SelectTrigger>
      <SelectContent>
        <SelectItem label="Default order" value="" />
        {#each sorts as option (option.value)}
          <SelectItem label={option.label} value={option.value} />
        {/each}
      </SelectContent>
    </SelectRoot>
  {/if}
  {#if usableFilters.length > 0}
    <Button onclick={() => { filtersOpen = true; }} variant="outline">
      <ListFilter class="size-4" />
      Filters
      {#if activeCount > 0}
        <span class="bg-ink text-ink-foreground rounded-full px-1.5 text-xs">
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
          <ul class="flex flex-col">
            {#each group.options as option (option.value)}
              {@const isOn = (selected[group.key] ?? []).includes(option.value)}
              <li>
                <label class="hover:bg-surface-2 flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors">
                  <Checkbox
                    checked={isOn}
                    onCheckedChange={() => toggle(group.key, option.value)}
                  />
                  <span class="capitalize {isOn ? 'text-text font-medium' : 'text-text-muted'}">
                    {option.label}
                  </span>
                </label>
              </li>
            {/each}
          </ul>
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
