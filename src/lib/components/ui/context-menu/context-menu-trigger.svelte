<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
	import { cn } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		onkeydown,
		...restProps
	}: ContextMenuPrimitive.TriggerProps = $props();

	function openFromKeyboard(
		event: KeyboardEvent & { currentTarget: EventTarget & HTMLDivElement },
	) {
		onkeydown?.(event);
		const opens =
			event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
		if (
			!opens ||
			event.defaultPrevented ||
			!(event.target instanceof Element)
		) {
			return;
		}
		event.preventDefault();
		const box = event.target.getBoundingClientRect();
		event.target.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: box.left,
				clientY: box.bottom,
			}),
		);
	}
</script>

<ContextMenuPrimitive.Trigger
	bind:ref
	data-slot="context-menu-trigger"
	class={cn("select-none", className)}
	onkeydown={openFromKeyboard}
	{...restProps}
/>
