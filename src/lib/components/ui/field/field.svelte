<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	export const fieldVariants = tv({
		base: "group/field flex w-full gap-3 data-[invalid=true]:text-destructive",
		defaultVariants: {
			orientation: "vertical",
		},
		variants: {
			orientation: {
				horizontal:
					"cn-field-orientation-horizontal flex-row items-center has-[>[data-slot=field-content]]:items-start [&>[data-slot=field-label]]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
				responsive:
					"cn-field-orientation-responsive @md/field-group:flex-row flex-col @md/field-group:items-center @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:[&>*]:w-auto [&>*]:w-full [&>.sr-only]:w-auto @md/field-group:[&>[data-slot=field-label]]:flex-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
				vertical:
					"cn-field-orientation-vertical flex-col [&>*]:w-full [&>.sr-only]:w-auto",
			},
		},
	});

	export type FieldOrientation = VariantProps<
		typeof fieldVariants
	>["orientation"];
</script>

<script lang="ts">
import { cn, type WithElementRef } from "$lib/utils.js";
import type { HTMLAttributes } from "svelte/elements";

let {
  ref = $bindable(null),
  class: className,
  orientation = "vertical",
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
  orientation?: FieldOrientation;
} = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: shadcn component-->
<div
  class={cn(fieldVariants({ orientation }), className)}
  data-orientation={orientation}
  data-slot="field"
  role="group"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>
