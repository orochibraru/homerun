<script lang="ts">
	import { RotateCw, TriangleAlert } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import type { Snippet } from "svelte";

	import Alert from "./alert.svelte";

	const {
		title = "This page hit an error while rendering.",
		class: className = "",
		compact = false,
		children,
	}: {
		title?: string;
		class?: string;
		/** A small inline retry button instead of a full alert, for header and sidebar chrome. */
		compact?: boolean;
		children: Snippet;
	} = $props();

	function messageOf(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		if (
			typeof error === "object" &&
			error !== null &&
			"message" in error &&
			typeof error.message === "string"
		) {
			return error.message;
		}
		return String(error);
	}
</script>

<svelte:boundary>
	{@render children()}

	{#snippet failed(error: unknown, reset: () => void)}
		{#if compact}
			<Button
				class="text-red-500"
				onclick={reset}
				size="sm"
				title={messageOf(error)}
				variant="ghost"
			>
				<TriangleAlert class="size-4" />
				Didn't load, retry
			</Button>
		{:else}
			<div class={className}>
				<Alert {title}>
					{messageOf(error)}
					{#snippet actions()}
						<Button onclick={reset} size="sm" variant="outline">
							<RotateCw class="size-4" />
							Try again
						</Button>
					{/snippet}
				</Alert>
			</div>
		{/if}
	{/snippet}
</svelte:boundary>
