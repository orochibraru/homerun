<script lang="ts" module>
	export type AlertVariant = "error" | "info" | "success" | "warning";
</script>

<script lang="ts">
	import {
		AlertTriangle,
		CheckCircle2,
		Info,
		OctagonX,
	} from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils";

	const {
		variant = "error",
		title,
		class: className = "",
		actions,
		children,
	}: {
		variant?: AlertVariant;
		title?: string;
		class?: string;
		actions?: Snippet;
		children?: Snippet;
	} = $props();

	const TONE: Record<AlertVariant, string> = {
		error:
			"border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400",
		info: "border-border bg-surface-2 text-text-muted",
		success:
			"border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-400",
		warning:
			"border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400",
	};

	const ICON = {
		error: OctagonX,
		info: Info,
		success: CheckCircle2,
		warning: AlertTriangle,
	};

	const Icon = $derived(ICON[variant]);
</script>

<div
  class={cn(
    "flex items-start gap-3 rounded-md border p-4 text-sm",
    TONE[variant],
    className,
  )}
  role={variant === "error" ? "alert" : "status"}
>
  <Icon class="mt-0.5 size-4 shrink-0" />
  <div class="min-w-0 flex-1">
    {#if title}
      <p class="font-medium">{title}</p>
    {/if}
    {#if children}
      <div class={title ? "mt-0.5 text-xs opacity-90" : ""}>
        {@render children()}
      </div>
    {/if}
  </div>
  {#if actions}
    <div class="flex shrink-0 items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
