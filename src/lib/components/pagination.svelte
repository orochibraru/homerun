<script lang="ts">
	import { ChevronLeft, ChevronRight } from "@lucide/svelte";
	import { goto } from "$app/navigation";
	import { page as appPage } from "$app/state";
	import { Button } from "$lib/components/ui/button/index.js";

	interface Props {
		label?: string;
		page: number;
		pageParam?: string;
		perPage: number;
		total: number;
	}

	const {
		page,
		perPage,
		total,
		pageParam = "page",
		label = "items",
	}: Props = $props();

	const lastPage = $derived(Math.max(1, Math.ceil(total / perPage)));
	const first = $derived(total === 0 ? 0 : (page - 1) * perPage + 1);
	const last = $derived(Math.min(page * perPage, total));

	function goToPage(next: number) {
		const params = new URLSearchParams(appPage.url.searchParams);
		if (next <= 1) {
			params.delete(pageParam);
		} else {
			params.set(pageParam, String(next));
		}
		const query = params.toString();
		void goto(`${appPage.url.pathname}${query ? `?${query}` : ""}`, {
			keepFocus: true,
			noScroll: true,
		});
	}
</script>

{#if total > perPage}
  <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
    <p class="text-text-subtle tech text-xs">
      {first}–{last} of {total}
      {label}
    </p>
    <div class="flex items-center gap-2">
      <Button
        disabled={page <= 1}
        onclick={() => goToPage(page - 1)}
        size="sm"
        variant="outline"
      >
        <ChevronLeft class="size-4" />
        Previous
      </Button>
      <span class="text-text-muted tech text-xs">
        Page {page} of {lastPage}
      </span>
      <Button
        disabled={page >= lastPage}
        onclick={() => goToPage(page + 1)}
        size="sm"
        variant="outline"
      >
        Next
        <ChevronRight class="size-4" />
      </Button>
    </div>
  </div>
{/if}
