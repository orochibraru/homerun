<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		class?: string;
		percent: number;
		size?: number;
		stroke?: number;
	}

	const {
		children,
		class: className = "",
		percent,
		size = 64,
		stroke = 7,
	}: Props = $props();

	const radius = $derived((size - stroke) / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const filled = $derived(
		(Math.min(Math.max(percent, 0), 100) / 100) * circumference,
	);
</script>

<span
	class="relative inline-grid shrink-0 place-items-center {className}"
	style="width: {size}px; height: {size}px"
>
	<svg
		class="absolute inset-0 -rotate-90"
		aria-hidden="true"
		height={size}
		viewBox="0 0 {size} {size}"
		width={size}
	>
		<circle
			cx={size / 2}
			cy={size / 2}
			fill="none"
			r={radius}
			stroke="var(--color-border-light)"
			stroke-width={stroke}
		/>
		<circle
			class="transition-[stroke-dasharray] duration-500"
			cx={size / 2}
			cy={size / 2}
			fill="none"
			r={radius}
			stroke="var(--primary)"
			stroke-dasharray="{filled} {circumference}"
			stroke-linecap="round"
			stroke-width={stroke}
		/>
	</svg>
	{#if children}
		<span class="relative">{@render children()}</span>
	{/if}
</span>
