<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		placement?: "above" | "below";
		x: number;
		y: number;
	}

	const { children, placement = "above", x, y }: Props = $props();
</script>

<div
	class="pointer-events-none absolute z-20 rounded-xl px-3 py-2 text-xs leading-snug font-medium whitespace-nowrap shadow-lg {placement ===
	'above'
		? '-translate-x-1/2 -translate-y-[calc(100%+0.625rem)]'
		: '-translate-x-1/2 translate-y-2.5'}"
	data-slot="chart-tooltip"
	role="tooltip"
	style="left: {x}px; top: {y}px; background: var(--color-text); color: var(--color-surface)"
>
	{@render children()}
</div>
