<script lang="ts">
	import { cn } from "@orochibraru/ui/utils";
	import type { Snippet } from "svelte";

	import ChartTooltip from "#lib/components/chart-tooltip.svelte";

	interface Props {
		children: Snippet;
		class?: string;
		/** What a screen reader announces: the values the tooltip shows. */
		label: string;
		/** Runs on a click, for a target that opens more about what it shows. */
		onselect?: () => void;
		placement?: "above" | "below";
		tip: Snippet;
	}

	const {
		children,
		class: className = "",
		label,
		onselect,
		placement = "above",
		tip,
	}: Props = $props();

	let open = $state(false);
</script>

<button
	class={cn(
		"relative block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
		className,
	)}
	aria-label={label}
	onblur={() => (open = false)}
	onclick={() => {
		open = true;
		onselect?.();
	}}
	onfocus={() => (open = true)}
	onpointerenter={() => (open = true)}
	onpointerleave={(event) => {
		if (event.pointerType === "mouse") {
			open = false;
		}
	}}
	type="button"
>
	{@render children()}
	{#if open}
		<span
			class="absolute left-1/2 {placement === 'above' ? 'top-0' : 'bottom-0'}"
		>
			<ChartTooltip {placement} x={0} y={0}>
				{@render tip()}
			</ChartTooltip>
		</span>
	{/if}
</button>
