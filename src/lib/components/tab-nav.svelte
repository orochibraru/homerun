<script lang="ts">
	import type { Component } from "svelte";

	export interface NavTab {
		/** Rendered as a real link when set (route tabs); otherwise a button firing onSelect (in-page section tabs). */
		href?: string;
		icon?: Component;
		id: string;
		label: string;
		/** Small amber dot next to the label : a field on this tab needs attention (e.g. Settings' setup-issue highlight) even while it's not the active tab. */
		hasWarning?: boolean;
	}

	// overflow-x-auto + shrink-0 on every tab is the actual fix for "tabs
	// aren't responsive, can't scroll horizontally" : a plain `flex gap-1
	// border-b` (this component's predecessor, still the shape services/
	// [serviceId]'s own tab bar had) has no overflow handling at all, so a
	// row of ten tabs on a narrow viewport just clips or forces the whole
	// page to scroll sideways instead of the tab strip itself.
	const {
		active,
		onSelect,
		tabs,
	}: { active: string; onSelect?: (id: string) => void; tabs: NavTab[] } =
		$props();
</script>

<div class="border-border mb-6 flex gap-1 overflow-x-auto border-b">
  {#each tabs as tab (tab.id)}
    {@const isActive = tab.id === active}
    {@const TabIcon = tab.icon}
    {#if tab.href}
      <a
        class="
          relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-all duration-200
          {isActive
          ? 'border-accent text-accent drop-shadow-[0_0_6px_var(--color-accent-glow)]'
          : 'border-transparent text-text-muted hover:border-border-light hover:text-text'}
        "
        href={tab.href}
      >
        {#if TabIcon}<TabIcon class="size-4" />{/if}
        {tab.label}
        {#if tab.hasWarning}
          <span
            class="size-1.5 rounded-full bg-amber-400"
            title="Needs attention"
          ></span>
        {/if}
      </a>
    {:else}
      <button
        class="
          relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-all duration-200
          {isActive
          ? 'border-accent text-accent drop-shadow-[0_0_6px_var(--color-accent-glow)]'
          : 'border-transparent text-text-muted hover:border-border-light hover:text-text'}
        "
        onclick={() => onSelect?.(tab.id)}
        type="button"
      >
        {#if TabIcon}<TabIcon class="size-4" />{/if}
        {tab.label}
        {#if tab.hasWarning}
          <span
            class="size-1.5 rounded-full bg-amber-400"
            title="Needs attention"
          ></span>
        {/if}
      </button>
    {/if}
  {/each}
</div>
