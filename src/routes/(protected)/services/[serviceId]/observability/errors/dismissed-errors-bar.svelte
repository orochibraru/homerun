<script lang="ts">
	import { resolve } from "$app/paths";

	import type { ErrorDismissal } from "#lib/server/error-dismissal.js";

	const {
		dismissal,
		serviceId,
	}: { dismissal: ErrorDismissal; serviceId: string } = $props();

	const dismissedLabel = $derived(
		dismissal.dismissedBy
			? (dismissal.dismissedBy.gitCommit?.slice(0, 7) ??
					dismissal.dismissedBy.imageRef ??
					"a later revision")
			: null,
	);
</script>

{#if dismissal.dismissedCount > 0}
	<div
		class="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-4 py-2.5 text-xs"
	>
		<span class="text-text-muted">
			{dismissal.dismissedCount}
			{dismissal.dismissedCount === 1
				? "earlier error is"
				: "earlier errors are"}
			hidden
			{#if dismissal.dismissedBy}
				— cleared by revision
				<a
					class="text-accent underline"
					href={resolve(
						"/(protected)/services/[serviceId]/environments/revisions",
						{
							serviceId,
						},
					)}>{dismissedLabel}</a
				>
			{:else}
				— cleared by hand
			{/if}
		</span>
		<a
			class="text-text-subtle hover:text-text ml-auto underline"
			href="?dismissed={dismissal.showDismissed ? '0' : '1'}"
		>
			{dismissal.showDismissed ? "Hide them" : "Show them"}
		</a>
	</div>
{/if}
