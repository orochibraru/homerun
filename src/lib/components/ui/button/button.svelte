<script lang="ts" module>
	import type {
		HTMLAnchorAttributes,
		HTMLButtonAttributes,
	} from "svelte/elements";
	import { tv, type VariantProps } from "tailwind-variants";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import Spinner from "../spinner/spinner.svelte";

	export const buttonVariants = tv({
		base: "group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md border border-transparent bg-clip-padding font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		defaultVariants: {
			size: "default",
			variant: "default",
		},
		variants: {
			size: {
				default:
					"h-9 gap-1.5 in-data-[slot=button-group]:rounded-md px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
				icon: "size-9",
				"icon-lg": "size-10",
				"icon-sm":
					"size-8 in-data-[slot=button-group]:rounded-md rounded-[min(var(--radius-md),10px)]",
				"icon-xs":
					"size-6 in-data-[slot=button-group]:rounded-md rounded-[min(var(--radius-md),8px)] [&_svg:not([class*='size-'])]:size-3",
				lg: "h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
				sm: "h-8 gap-1 in-data-[slot=button-group]:rounded-md rounded-[min(var(--radius-md),10px)] px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
				xs: "h-6 gap-1 in-data-[slot=button-group]:rounded-md rounded-[min(var(--radius-md),8px)] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
			},
			variant: {
				default:
					"bg-accent text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_1px_2px_rgba(0,0,0,0.16)] hover:brightness-110 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.28),0_0_0_4px_var(--color-accent-light),0_1px_2px_rgba(0,0,0,0.16)]",
				destructive:
					"bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 dark:hover:bg-destructive/30",
				ghost:
					"text-text-muted hover:bg-surface-2 hover:text-text aria-expanded:bg-surface-2 aria-expanded:text-text",
				link: "text-accent underline-offset-4 hover:underline",
				outline:
					"border-border bg-surface-2 text-text shadow-[inset_0_1px_0_0_var(--glass-highlight)] backdrop-blur-md hover:border-border-light hover:bg-surface-3 aria-expanded:bg-surface-3",
				secondary:
					"bg-surface-2 text-text shadow-[inset_0_1px_0_0_var(--glass-highlight)] backdrop-blur-md hover:bg-surface-3 aria-expanded:bg-surface-3",
			},
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			loading?: boolean;
		};
</script>

<script lang="ts">
let {
  class: className,
  variant = "default",
  size = "default",
  ref = $bindable(null),
  href,
  type = "button",
  disabled,
  loading,
  children,
  ...restProps
}: ButtonProps = $props();
</script>

{#if href}
  <a
    aria-disabled={disabled}
    class={cn(buttonVariants({ size, variant }), className)}
    data-slot="button"
    href={disabled ? undefined : href}
    role={disabled ? "link" : undefined}
    tabindex={disabled ? -1 : undefined}
    bind:this={ref}
    {...restProps}
  >
    {#if loading}
      <Spinner />
    {:else}
      {@render children?.()}
    {/if}
  </a>
{:else}
  <button
    class={cn(buttonVariants({ size, variant }), className)}
    data-slot="button"
    {disabled}
    {type}
    bind:this={ref}
    {...restProps}
  >
    {#if loading}
      <Spinner />
    {:else}
      {@render children?.()}
    {/if}
  </button>
{/if}
