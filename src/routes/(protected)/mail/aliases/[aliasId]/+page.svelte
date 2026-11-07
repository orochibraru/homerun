<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { Forward, Trash2, TriangleAlert } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import MailAliasFields from "#lib/components/mail-alias-fields.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { queuedJobToast } from "#lib/job-toast.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data, form } = $props();

	let saving = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteForm: HTMLFormElement | undefined = $state();

	const label = $derived(
		data.alias.localPart
			? data.alias.address
			: `Anything @${data.alias.domain}`,
	);
</script>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description={data.alias.localPart
			? "Mail to this address is forwarded."
			: "Catches every address on the domain that isn't a mailbox or another alias."}
		icon={Forward}
		title={label}
	>
		{#snippet trailing()}
			<SaveButton form="alias-settings" pending={saving} />
		{/snippet}
	</PanelHeader>
	<form
		id="alias-settings"
		action="?/update"
		class="space-y-4 p-5"
		method="POST"
		use:enhance={queuedJobToast({
			error: "Couldn't save the alias.",
			loading: "Saving the alias",
			onSettled: () => {
				saving = false;
			},
			onStart: () => {
				saving = true;
			},
			success: "Alias saved.",
		})}
	>
		{#if form?.error}
			<p class="text-sm text-red-500">{form.error}</p>
		{/if}
		<MailAliasFields values={data.alias} />
	</form>
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
			error: "Couldn't delete the alias.",
			loading: "Deleting the alias",
			success: "Alias deleted.",
		})}
	>
		<div>
			<p class="text-text text-sm font-medium">Delete this alias</p>
			<p class="text-text-muted mt-0.5 text-xs">
				Mail to it bounces from then on, unless a catch-all takes it.
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
	<a class="text-accent underline" href={resolve("mail/aliases")}
		>Back to aliases</a
	>
</p>

<ConfirmDialog
	bind:open={deleteDialogOpen}
	confirmLabel="Delete alias"
	description={`Delete ${label}?`}
	onConfirm={() => deleteForm?.requestSubmit()}
	title="Delete alias"
/>
