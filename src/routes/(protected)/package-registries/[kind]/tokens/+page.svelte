<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { Plus, Ticket, Trash2 } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data } = $props();

	let confirmOpen = $state(false);
	let confirmTitle = $state("");
	let confirmForm: HTMLFormElement | null = null;

	function requestConfirm(event: MouseEvent, title: string) {
		confirmForm = (event.currentTarget as HTMLElement).closest("form");
		confirmTitle = title;
		confirmOpen = true;
	}
</script>

<div class="mb-4 flex items-center justify-between gap-4">
	<p class="text-text-muted text-sm">
		A token can install and publish. Hand out one per user or CI job and revoke
		the one you're done with.
	</p>
	<Button
		href={resolve("/(protected)/package-registries/[kind]/tokens/new", {
			kind: data.kind,
		})}
	>
		<Plus class="size-4" />
		New token
	</Button>
</div>

{#if data.tokens.length === 0}
	<EmptyState
		icon={Ticket}
		subtitle="Create one to install from or publish to this registry."
		title="No tokens yet"
	/>
{:else}
	<ul
		class="border-border bg-surface-1 divide-border divide-y rounded-lg border"
	>
		{#each data.tokens as token (token.id)}
			<li class="flex items-center justify-between gap-3 px-4 py-3">
				<div class="min-w-0">
					<p class="text-text font-mono text-sm">{token.username}</p>
					<p class="text-text-muted mt-0.5 text-xs">
						Created {timeAgo(token.createdAt)}
					</p>
				</div>
				<form
					action="?/revoke"
					method="POST"
					use:enhance={enhanceToast({
						error: "Couldn't revoke that token.",
						loading: `Revoking ${token.username}`,
						success: "Token revoked.",
					})}
				>
					<input name="id" type="hidden" value={token.id} />
					<Button
						onclick={(event: MouseEvent) =>
							requestConfirm(event, `Revoke ${token.username}?`)}
						size="sm"
						type="button"
						variant="ghost"
					>
						<Trash2 class="size-3.5" />
						Revoke
					</Button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<ConfirmDialog
	bind:open={confirmOpen}
	confirmLabel="Revoke"
	description="Anything using this token stops being able to install or publish as soon as the registry rereads its auth file, which happens straight away."
	onConfirm={() => confirmForm?.requestSubmit()}
	title={confirmTitle}
/>
