<script lang="ts">
	import { Check, Copy } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { cn } from "$lib/utils";

	const {
		value,
		label,
		text,
		class: className = "",
	}: {
		value: string;
		label?: string;
		text?: string;
		class?: string;
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

<button
  aria-label={label ? `Copy ${label}` : "Copy"}
  class={cn(
    "text-text-subtle hover:bg-surface-3 hover:text-text inline-flex shrink-0 items-center gap-1.5 rounded-md p-1.5 text-xs transition-colors",
    className,
  )}
  onclick={handleCopy}
  type="button"
>
  {#if copied}
    <Check class="size-3.5 text-emerald-500" />
  {:else}
    <Copy class="size-3.5" />
  {/if}
  {#if text}
    <span>{text}</span>
  {/if}
</button>
