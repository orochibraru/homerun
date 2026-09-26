<script lang="ts">
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { getDashboardIcons } from "$lib/remote/dashboard-icons.remote";
	import { DASHBOARD_ICON_PREFIX, iconSrc } from "$lib/service-icon";

	interface Props {
		onpick: (icon: string) => void;
		selected: string;
	}

	const { onpick, selected }: Props = $props();

	const PAGE = 48;
	const catalog = getDashboardIcons();

	let search = $state("");
	let category = $state("");
	let limit = $state(PAGE);

	const categories = $derived(
		[
			...new Set((catalog.current ?? []).flatMap((icon) => icon.categories)),
		].sort(),
	);
	const matches = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		return (catalog.current ?? []).filter(
			(icon) =>
				(!category || icon.categories.includes(category)) &&
				(!needle ||
					icon.name.includes(needle.replaceAll(/\s+/g, "-")) ||
					icon.aliases.some((alias) => alias.toLowerCase().includes(needle))),
		);
	});
</script>

<div>
  <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
    <span class={label}>
      Dashboard Icons
      <a
        class="text-text-subtle hover:text-text ml-1 font-normal underline"
        href="https://dashboardicons.com"
        rel="noopener noreferrer"
        target="_blank"
      >dashboardicons.com</a>
    </span>
    <div class="flex w-full flex-wrap gap-2 sm:w-auto">
      <SelectRoot
        onValueChange={() => {
          limit = PAGE;
        }}
        type="single"
        bind:value={category}
      >
        <SelectTrigger class="w-full sm:w-44 {category ? 'capitalize' : ''}" aria-label="Icon category">
          {category ? category.replaceAll("-", " ") : "All categories"}
        </SelectTrigger>
        <SelectContent>
          <SelectItem label="All categories" value="" />
          {#each categories as option (option)}
            <SelectItem class="capitalize" label={option.replaceAll("-", " ")} value={option} />
          {/each}
        </SelectContent>
      </SelectRoot>
      <Input
        class="w-full sm:w-56"
        aria-label="Search Dashboard Icons"
        oninput={() => {
          limit = PAGE;
        }}
        placeholder="Search icons…"
        type="search"
        bind:value={search}
      />
    </div>
  </div>

  {#if catalog.error}
    <p class="text-text-subtle text-xs">
      Couldn't load the Dashboard Icons catalog. The library above and uploads
      still work.
    </p>
  {:else if !catalog.ready}
    <p class="text-text-subtle flex items-center gap-2 text-xs">
      <Spinner />
      Loading the catalog
    </p>
  {:else}
    <div class="max-h-80 overflow-y-auto">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
        {#each matches.slice(0, limit) as entry (entry.name)}
          {@const value = `${DASHBOARD_ICON_PREFIX}${entry.name}`}
          <button
            class="
              flex aspect-square items-center justify-center rounded-md border p-2 transition-colors {selected ===
              value
              ? 'border-accent bg-accent-light'
              : 'border-border hover:bg-surface-2'}
            "
            aria-label={entry.name}
            onclick={() => onpick(value)}
            title={entry.name}
            type="button"
          >
            <img
              alt=""
              class="size-full object-contain"
              loading="lazy"
              onerror={(event) => {
                event.currentTarget.setAttribute("hidden", "");
              }}
              src={iconSrc(value)}
            >
          </button>
        {:else}
          <p class="text-text-subtle col-span-full text-xs">No icon matches.</p>
        {/each}
      </div>
      {#if matches.length > limit}
        <Button
          class="mt-2"
          onclick={() => {
            limit += PAGE;
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Show more ({matches.length - limit} left)
        </Button>
      {/if}
    </div>
  {/if}
</div>
