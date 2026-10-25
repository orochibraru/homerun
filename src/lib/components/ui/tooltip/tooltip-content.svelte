<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import { cn } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 6,
		...restProps
	}: TooltipPrimitive.ContentProps = $props();
</script>

<TooltipPrimitive.Portal>
	<TooltipPrimitive.Content
		bind:ref
		data-slot="tooltip-content"
		{sideOffset}
		class={cn(
			"z-50 rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-ink-foreground shadow-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
			className
		)}
		{...restProps}
	/>
</TooltipPrimitive.Portal>
