<script lang="ts">
	import { type Component, type Snippet, untrack } from "svelte";
	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import { useSubNav } from "#lib/sub-nav.svelte.js";
	import { page } from "$app/state";

	export interface NavTab {
		/** Rendered as a real link when set (route tabs); otherwise a button firing onSelect (in-page section tabs). */
		href?: string;
		icon?: Component;
		id: string;
		label: string;
		/** Small amber dot next to the label : a field on this tab needs attention (e.g. Settings' setup-issue highlight) even while it's not the active tab. */
		hasWarning?: boolean;
	}

	const {
		active,
		children,
		onSelect,
		tabs,
	}: {
		active: string;
		children?: Snippet;
		onSelect?: (id: string) => void;
		tabs: NavTab[];
	} = $props();

	const subNav = useSubNav();
	const owner = {};
	const beside = $derived(
		subNav !== undefined && page.data.preferences?.tabLayout === "vertical",
	);

	if (subNav && untrack(() => beside)) {
		subNav.current = untrack(() => ({ active, onSelect, owner, tabs }));
	}

	$effect.pre(() => {
		if (!subNav) {
			return;
		}
		if (beside) {
			subNav.current = { active, onSelect, owner, tabs };
		} else if (subNav.current?.owner === owner) {
			subNav.current = null;
		}
		return () => {
			if (subNav.current?.owner === owner) {
				subNav.current = null;
			}
		};
	});

	let strip = $state<HTMLDivElement>();

	$effect(() => {
		const current =
			active && strip?.querySelector<HTMLElement>("[data-active]");
		if (
			strip &&
			current &&
			(current.offsetLeft < strip.scrollLeft ||
				current.offsetLeft + current.offsetWidth >
					strip.scrollLeft + strip.clientWidth)
		) {
			strip.scrollLeft =
				current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
		}
	});

	function tabClass(isActive: boolean): string {
		return `group flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-[0.8125rem] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
			isActive
				? "bg-surface text-text shadow-sm ring-1 ring-border"
				: "text-text-muted hover:bg-surface/60 hover:text-text"
		}`;
	}
</script>

{#snippet content(tab: NavTab, isActive: boolean)}
  {@const TabIcon = tab.icon}
  {#if TabIcon}
    <TabIcon
      class="size-3.5 shrink-0 transition-colors {isActive ? 'text-accent' : 'text-text-subtle group-hover:text-accent'}"
    />
  {/if}
  {tab.label}
  {#if tab.hasWarning}
    <span class="size-1.5 shrink-0 rounded-full bg-amber-400" title="Needs attention"></span>
  {/if}
{/snippet}

<div
  bind:this={strip}
  class="mb-5 overflow-x-auto {beside ? 'md:hidden' : ''}"
  data-slot="tab-nav"
>
  <div class="bg-surface-2 inline-flex min-w-max gap-1 rounded-lg p-1">
    {#each tabs as tab (tab.id)}
      {@const isActive = tab.id === active}
      {#if tab.href}
        <a
          class={tabClass(isActive)}
          aria-current={isActive ? "page" : undefined}
          data-active={isActive || undefined}
          href={tab.href}
        >
          {@render content(tab, isActive)}
        </a>
      {:else}
        <button
          class={tabClass(isActive)}
          data-active={isActive || undefined}
          onclick={() => onSelect?.(tab.id)}
          type="button"
        >
          {@render content(tab, isActive)}
        </button>
      {/if}
    {/each}
  </div>
</div>

{#if children}
  <ErrorBoundary title="This tab hit an error while rendering.">
    {@render children()}
  </ErrorBoundary>
{/if}
