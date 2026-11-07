<script lang="ts">
	import { enhance } from "$app/forms";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		CircleAlert,
		CircleCheck,
		CircleX,
		CloudUpload,
		RefreshCw,
		Trash2,
		TriangleAlert,
	} from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { toast } from "svelte-sonner";

	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import CopyButton from "#lib/components/copy-button.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { enhanceToast, toastError } from "#lib/toast.js";

	const { data } = $props();

	let publishing = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteForm: HTMLFormElement | undefined = $state();

	const allOk = $derived(data.checks.every((check) => check.state === "ok"));

	function handleRecheck() {
		return toast.promise(refreshAll(), {
			error: (err) => toastError(err, "Couldn't check the records."),
			loading: "Checking the records",
			success: "Records checked.",
		});
	}
</script>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description={allOk
			? "Every record is in place, as public resolvers see it."
			: "Add these at your DNS provider. Changes can take a while to show up."}
		icon={allOk ? CircleCheck : CircleAlert}
		title="DNS records for {data.domain.name}"
	>
		{#snippet trailing()}
			<div class="flex gap-2">
				<Button onclick={handleRecheck} size="sm" variant="outline"
					><RefreshCw class="size-4" />Check again</Button
				>
				{#if data.managedBy}
					<form
						action="?/publish"
						method="POST"
						use:enhance={enhanceToast({
							error: "Couldn't publish the records.",
							loading: "Publishing the records",
							onSettled: () => {
								publishing = false;
							},
							onStart: () => {
								publishing = true;
							},
							success: (result) =>
								Array.isArray(result?.lines)
									? result.lines.join(" · ")
									: "Records published.",
						})}
					>
						<Button disabled={publishing} size="sm" type="submit"
							><CloudUpload class="size-4" />Publish to {data.managedBy}</Button
						>
					</form>
				{/if}
			</div>
		{/snippet}
	</PanelHeader>
	<div class="divide-border divide-y">
		{#each data.checks as check (`${check.record.type}-${check.record.name}`)}
			<div class="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-start">
				<div class="flex w-28 shrink-0 items-center gap-2">
					{#if check.state === "ok"}
						<CircleCheck class="size-4 text-emerald-500" />
					{:else if check.state === "different"}
						<CircleAlert class="size-4 text-amber-500" />
					{:else}
						<CircleX class="size-4 text-red-500" />
					{/if}
					<span class="text-text font-mono text-xs font-semibold"
						>{check.record.type}</span
					>
					{#if check.record.priority !== null}
						<span class="text-text-subtle font-mono text-xs"
							>{check.record.priority}</span
						>
					{/if}
				</div>
				<div class="min-w-0 flex-1 space-y-1">
					<p class="text-text-muted text-xs">{check.record.purpose}</p>
					<div class="flex items-center gap-1">
						<code class="text-text font-mono text-xs break-all"
							>{check.record.name}</code
						>
						<CopyButton value={check.record.name} />
					</div>
					{#if check.record.content}
						<div class="flex items-start gap-1">
							<code
								class="bg-surface-2 text-text rounded px-2 py-1 font-mono text-xs break-all"
								>{check.record.content}</code
							>
							<CopyButton value={check.record.content} />
						</div>
					{:else}
						<p class="text-text-subtle text-xs">
							An A (or AAAA) record with this server's public address.
						</p>
					{/if}
					{#if check.state !== "ok" && check.found.length > 0}
						<p class="text-text-subtle text-xs break-all">
							Found instead: {check.found.join(" · ")}
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
	<p class="text-text-subtle border-border border-t px-5 py-3 text-xs">
		Also ask your hosting provider for a reverse DNS (PTR) record of the
		server's IP pointing at the mail hostname, and make sure it lets outgoing
		traffic on port 25 through: many big providers block it by default.
	</p>
</section>

<section
	class="bg-surface rounded-md border border-red-200 dark:border-red-900/40"
>
	<div
		class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30"
	>
		<div
			class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600"
		>
			<TriangleAlert class="size-4" />
		</div>
		<h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
			Danger zone
		</h2>
	</div>
	<form
		action="?/delete"
		class="flex flex-wrap items-center justify-between gap-4 p-5"
		method="POST"
		bind:this={deleteForm}
		use:enhance={enhanceToast({
			error: "Couldn't delete the domain.",
			loading: "Deleting the domain",
			success: "Domain deleted.",
		})}
	>
		<div>
			<p class="text-text text-sm font-medium">Delete this domain</p>
			<p class="text-text-muted mt-0.5 text-xs">
				Every mailbox and alias on it goes too, and so does the mail they hold.
			</p>
		</div>
		<Button
			onclick={() => (deleteDialogOpen = true)}
			type="button"
			variant="destructive"
		>
			<Trash2 class="size-4" />
			Delete
		</Button>
	</form>
</section>

<p class="mt-4 text-xs">
	<a class="text-accent underline" href={resolve("mail")}>Back to domains</a>
</p>

<ConfirmDialog
	bind:open={deleteDialogOpen}
	confirmLabel="Delete domain"
	confirmPhrase={data.domain.name}
	description={`Delete ${data.domain.name}? Its mailboxes, their mail and its aliases are deleted. This can't be undone.`}
	onConfirm={() => deleteForm?.requestSubmit()}
	title="Delete mail domain"
/>
