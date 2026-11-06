<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		placement?: "above" | "below";
		x: number;
		y: number;
	}

	const { children, placement = "above", x, y }: Props = $props();

	let origin = $state<HTMLSpanElement>();
	let tip = $state<HTMLDivElement>();

	$effect(() => {
		tip?.showPopover();
	});

	$effect(() => {
		const element = tip;
		const anchor = origin;
		if (!(element && anchor)) {
			return;
		}
		const offsetX = x;
		const offsetY = y;
		const place = () => {
			const rect = anchor.getBoundingClientRect();
			element.style.left = `${rect.left + offsetX}px`;
			element.style.top = `${rect.top + offsetY}px`;
		};
		place();
		document.addEventListener("scroll", place, {
			capture: true,
			passive: true,
		});
		window.addEventListener("resize", place);
		return () => {
			document.removeEventListener("scroll", place, { capture: true });
			window.removeEventListener("resize", place);
		};
	});
</script>

<span bind:this={origin} class="pointer-events-none absolute top-0 left-0"
></span>
<div
	bind:this={tip}
	class="pointer-events-none inset-auto m-0 overflow-visible rounded-xl border-0 px-3 py-2 text-xs leading-snug font-medium whitespace-nowrap shadow-lg {placement ===
	'above'
		? '-translate-x-1/2 -translate-y-[calc(100%+0.625rem)]'
		: '-translate-x-1/2 translate-y-2.5'}"
	data-slot="chart-tooltip"
	popover="manual"
	role="tooltip"
	style="background: var(--color-text); color: var(--color-surface)"
>
	{@render children()}
</div>
