<script lang="ts">
	import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
	import InfoIcon from "@lucide/svelte/icons/info";
	import OctagonXIcon from "@lucide/svelte/icons/octagon-x";
	import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
	import { mode } from "mode-watcher";
	import {
		Toaster as Sonner,
		type ToasterProps as SonnerProps,
	} from "svelte-sonner";
	import Spinner from "#lib/components/ui/spinner/spinner.svelte";

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
  class="toaster group"
  mobileOffset={{ bottom: "var(--toast-bottom, 16px)" }}
  offset={{ bottom: "var(--toast-bottom, 24px)" }}
  style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border)"
  theme={mode.current}
  toastOptions={{
    classes: {
      actionButton:
        "rounded-md! bg-ink! font-medium! text-ink-foreground! hover:opacity-90!",
      cancelButton: "rounded-md! bg-surface-2! text-text-muted!",
      closeButton: "border-border! bg-popover! text-text-muted! hover:text-text!",
    },
  }}
  {...restProps}
>
  {#snippet loadingIcon()}
    <Spinner />
  {/snippet}
  {#snippet successIcon()}
    <CircleCheckIcon class="size-4" />
  {/snippet}
  {#snippet errorIcon()}
    <OctagonXIcon class="size-4" />
  {/snippet}
  {#snippet infoIcon()}
    <InfoIcon class="size-4" />
  {/snippet}
  {#snippet warningIcon()}
    <TriangleAlertIcon class="size-4" />
  {/snippet}
</Sonner>
