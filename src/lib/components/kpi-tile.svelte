<script lang="ts">
	import type { Component } from "svelte";

	export type KpiTone = "hero" | "mauve" | "sand" | "sky";

	interface Props {
		delta?: { good: boolean; text: string };
		icon: Component<{ class?: string }>;
		label: string;
		tone?: KpiTone;
		unit?: string;
		value: string;
	}

	const {
		delta,
		icon: Icon,
		label,
		tone = "sand",
		unit,
		value,
	}: Props = $props();

	const background: Record<KpiTone, string> = {
		hero: "var(--tile-a, var(--primary))",
		mauve: "var(--tile-c, var(--color-surface-2))",
		sand: "var(--tile-b, var(--color-surface-2))",
		sky: "var(--tile-d, var(--color-surface-2))",
	};
	const hero = $derived(tone === "hero");
</script>

<div
	class="relative flex min-h-21 items-center gap-3.5 overflow-hidden rounded-2xl px-4.5 py-4 {hero
		? 'text-white'
		: 'text-text'}"
	data-slot="kpi-tile"
	style="background: {background[tone]}"
>
	<span
		class="flex size-10.5 shrink-0 items-center justify-center rounded-full {hero
			? 'bg-white/15 ring-1 ring-white/15'
			: 'shadow-sm'}"
		style={hero
			? undefined
			: "background: var(--tile-icon-bg, var(--color-surface))"}
	>
		<Icon class="size-4.5" />
	</span>
	<div class="min-w-0">
		<p
			class="truncate text-xs font-semibold {hero
				? 'text-white/75'
				: 'text-text-muted'}"
		>
			{label}
		</p>
		<p
			class="flex items-baseline gap-1 text-[1.625rem] leading-tight font-medium tracking-[-0.035em] tabular-nums"
		>
			{value}
			{#if unit}
				<span
					class="text-[0.8125rem] font-medium tracking-normal {hero
						? 'text-white/70'
						: 'text-text-muted'}">{unit}</span
				>
			{/if}
		</p>
	</div>
	{#if delta}
		<span
			class="absolute top-3.5 right-4 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold {hero
				? 'bg-white/15 text-white'
				: delta.good
					? 'bg-white/60 text-emerald-700 dark:bg-white/7 dark:text-emerald-300'
					: 'bg-white/60 text-red-700 dark:bg-white/7 dark:text-red-300'}"
		>
			{delta.text}
		</span>
	{/if}
</div>
