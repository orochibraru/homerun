<script lang="ts">
	import { enhance } from "$app/forms";
	import { Ghost, Trash2 } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";

	import AsyncBlock from "#lib/components/async-block.svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { getOrphanBackups } from "#lib/remote/backups.remote.js";
	import { enhanceToast } from "#lib/toast.js";

	const { destinationId }: { destinationId: string } = $props();

	const orphans = $derived(getOrphanBackups(destinationId));

	let pending = $state<string[]>([]);
	let queued = $state<string[]>([]);
	let confirmOpen = $state(false);
	let deleting = $state(false);
	let form = $state<HTMLFormElement | null>(null);

	function requestDelete(paths: string[]) {
		pending = paths;
		confirmOpen = true;
	}
</script>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="Backups of volumes that were deleted without them. No cleanup reaches them: they stay here until deleted."
		icon={Ghost}
		title="Orphaned backups"
	/>
	<div class="p-5">
		<AsyncBlock errorTitle="Couldn't list this destination." query={orphans}>
			{#snippet pending()}
				<Skeleton class="h-10 w-full" />
			{/snippet}
			{#snippet children(repositories)}
				{@const waiting = repositories.filter(
					(repository) => !queued.includes(repository.path),
				)}
				{#if repositories.length === 0}
					<p class="text-text-muted text-sm">
						None: every backup here belongs to a volume that still exists.
					</p>
				{:else}
					<ul class="divide-border divide-y text-sm">
						{#each repositories as repository (repository.path)}
							<li class="flex items-center justify-between gap-3 py-2">
								<span class="text-text min-w-0 truncate font-mono text-xs">
									{repository.path}
								</span>
								{#if queued.includes(repository.path)}
									<span class="text-text-muted shrink-0 text-xs">
										Deletion queued
									</span>
								{:else}
									<Button
										class="shrink-0 text-red-500 hover:bg-red-500/10 hover:text-red-500"
										disabled={deleting}
										onclick={() => requestDelete([repository.path])}
										size="sm"
										variant="ghost"
									>
										<Trash2 class="size-3.5" />
										Delete
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
					{#if waiting.length > 1}
						<Button
							class="mt-3"
							disabled={deleting}
							onclick={() =>
								requestDelete(waiting.map((repository) => repository.path))}
							size="sm"
							variant="destructive"
						>
							<Trash2 class="size-3.5" />
							Delete all {waiting.length}
						</Button>
					{/if}
				{/if}
			{/snippet}
		</AsyncBlock>
		<form
			class="hidden"
			action="?/deleteOrphans"
			method="POST"
			use:enhance={enhanceToast({
				error: "Couldn't queue the deletion.",
				loading: "Queueing the deletion",
				onSettled: () => {
					deleting = false;
				},
				onStart: () => {
					deleting = true;
				},
				onSuccess: (result) => {
					queued = [
						...queued,
						...((result as { queued?: string[] } | undefined)?.queued ?? []),
					];
				},
				success: "Deletion queued: follow it in the job queue.",
			})}
			bind:this={form}
		>
			{#each pending as path (path)}
				<input name="path" type="hidden" value={path} />
			{/each}
		</form>
	</div>
</section>

<ConfirmDialog
	bind:open={confirmOpen}
	confirmLabel="Delete"
	description={pending.length === 1
		? `Delete ${pending[0]} and every snapshot in it? There's no getting them back.`
		: `Delete these ${pending.length} repositories and every snapshot in them? There's no getting them back.`}
	onConfirm={() => form?.requestSubmit()}
	title="Delete orphaned backups"
/>
