<script lang="ts">
	import { Check, Copy } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { cn } from "$lib/utils";

	const {
		value,
		label,
		class: className = "",
		truncate = false,
	}: {
		value: string;
		label?: string;
		class?: string;
		truncate?: boolean;
	} = $props();

	let copied = $state(false);
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyCallback(): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
		} catch (error) {
			throw new Error(
				error instanceof Error && error.message
					? error.message
					: "Clipboard access was refused.",
			);
		}
		copied = true;
		clearTimeout(resetTimer);
		resetTimer = setTimeout(() => {
			copied = false;
		}, 1500);
	}

	function handleCopy() {
		return toast.promise(copyCallback(), {
			error: () => "Couldn't copy : select and copy it manually.",
			loading: "Copying",
			success: "Copied to clipboard.",
		});
	}
</script>

<div
  class={cn(
    "border-border bg-surface-2 flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3",
    className,
  )}
>
  <code
    class={cn(
      "text-text min-w-0 flex-1 font-mono text-xs",
      truncate ? "truncate" : "overflow-x-auto whitespace-nowrap",
    )}
  >{value}</code>
  <button
    aria-label={label ? `Copy ${label}` : "Copy"}
    class="text-text-subtle hover:bg-surface-3 hover:text-text shrink-0 rounded-md p-1.5 transition-colors"
    onclick={handleCopy}
    type="button"
  >
    {#if copied}
      <Check class="size-3.5 text-emerald-500" />
    {:else}
      <Copy class="size-3.5" />
    {/if}
  </button>
</div>
