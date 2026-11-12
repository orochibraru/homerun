<script lang="ts">
	import { enhance } from "$app/forms";
	import { Eraser, HardDrive } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";

	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { formatBytes } from "#lib/formatting.js";
	import type { MailFolder, MailQuota } from "#lib/mail-doveadm.js";
	import { enhanceToast } from "#lib/toast.js";

	interface Props {
		contents: { folders: MailFolder[]; quota: MailQuota } | null;
	}

	const { contents }: Props = $props();

	let emptyDialogOpen = $state(false);
	let pendingFolder = $state("");
	let emptyForm: HTMLFormElement | undefined = $state();

	const percent = $derived(
		contents?.quota.limitBytes
			? Math.min(
					100,
					Math.round(
						(contents.quota.usedBytes / contents.quota.limitBytes) * 100,
					),
				)
			: null,
	);
	const totalMessages = $derived(
		contents?.folders.reduce((sum, folder) => sum + folder.messages, 0) ?? 0,
	);
	const totalUnseen = $derived(
		contents?.folders.reduce((sum, folder) => sum + folder.unseen, 0) ?? 0,
	);

	function requestEmpty(folder: string) {
		pendingFolder = folder;
		emptyDialogOpen = true;
	}
</script>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description={contents
			? "What the mailbox holds, as Dovecot counts it."
			: "Shown once the mail server runs and the mailbox has received something."}
		icon={HardDrive}
		title="Storage"
	/>
	{#if contents}
		<div class="space-y-4 px-5 py-4">
			<dl class="grid gap-3 text-sm sm:grid-cols-4">
				<div>
					<dt class="text-text-muted text-xs">Used</dt>
					<dd class="text-text mt-0.5">
						{formatBytes(contents.quota.usedBytes)}
						{#if contents.quota.limitBytes}
							<span class="text-text-muted">
								of {formatBytes(contents.quota.limitBytes)}</span
							>
						{/if}
					</dd>
				</div>
				<div>
					<dt class="text-text-muted text-xs">Messages</dt>
					<dd class="text-text mt-0.5">{totalMessages}</dd>
				</div>
				<div>
					<dt class="text-text-muted text-xs">Unread</dt>
					<dd class="text-text mt-0.5">{totalUnseen}</dd>
				</div>
				<div>
					<dt class="text-text-muted text-xs">Folders</dt>
					<dd class="text-text mt-0.5">{contents.folders.length}</dd>
				</div>
			</dl>
			{#if percent !== null}
				<div
					class="bg-surface-2 h-2 overflow-hidden rounded-full"
					title="{percent}% of the quota"
				>
					<div
						class="h-full rounded-full {percent >= 95
							? 'bg-red-500'
							: percent >= 80
								? 'bg-amber-500'
								: 'bg-accent'}"
						style="width: {percent}%"
					></div>
				</div>
			{/if}
		</div>
		<form
			action="?/emptyFolder"
			method="POST"
			bind:this={emptyForm}
			use:enhance={enhanceToast({
				error: "Couldn't empty the folder.",
				loading: "Emptying the folder",
				success: (result) =>
					typeof result?.folder === "string"
						? `${result.folder} emptied.`
						: "Folder emptied.",
			})}
		>
			<input name="folder" type="hidden" value={pendingFolder} />
		</form>
		<table class="w-full text-sm">
			<thead>
				<tr class="text-text-muted border-border border-y text-left text-xs">
					<th class="px-5 py-2 font-medium">Folder</th>
					<th class="px-3 py-2 text-right font-medium">Messages</th>
					<th class="px-3 py-2 text-right font-medium">Unread</th>
					<th class="px-3 py-2 text-right font-medium">Size</th>
					<th class="px-5 py-2"></th>
				</tr>
			</thead>
			<tbody class="divide-border divide-y">
				{#each contents.folders as folder (folder.name)}
					<tr>
						<td class="text-text px-5 py-2 font-mono text-xs">{folder.name}</td>
						<td class="text-text px-3 py-2 text-right">{folder.messages}</td>
						<td class="text-text px-3 py-2 text-right">{folder.unseen}</td>
						<td class="text-text px-3 py-2 text-right"
							>{formatBytes(folder.sizeBytes)}</td
						>
						<td class="px-5 py-2 text-right">
							<Button
								disabled={folder.messages === 0}
								onclick={() => requestEmpty(folder.name)}
								size="icon-sm"
								title="Empty {folder.name}"
								type="button"
								variant="ghost"><Eraser class="size-4" /></Button
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<ConfirmDialog
	bind:open={emptyDialogOpen}
	confirmLabel="Empty folder"
	description={`Delete every message in ${pendingFolder}? This can't be undone.`}
	onConfirm={() => emptyForm?.requestSubmit()}
	title="Empty folder"
/>
