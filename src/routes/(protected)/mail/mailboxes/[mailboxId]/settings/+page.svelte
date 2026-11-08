<script lang="ts">
	import { enhance } from "$app/forms";
	import { AtSign, KeyRound, Trash2, TriangleAlert } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import MailMailboxFields from "#lib/components/mail-mailbox-fields.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import PasswordField from "#lib/components/password-field.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { queuedJobToast } from "#lib/job-toast.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data, form } = $props();

	let saving = $state(false);
	let changingPassword = $state(false);
	let password = $state("");
	let deleteDialogOpen = $state(false);
	let deleteForm: HTMLFormElement | undefined = $state();
</script>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="Its display name, quota and whether it can sign in."
		icon={AtSign}
		title="Mailbox"
	>
		{#snippet trailing()}
			<SaveButton form="mailbox-settings" pending={saving} />
		{/snippet}
	</PanelHeader>
	<form
		id="mailbox-settings"
		action="?/update"
		class="space-y-4 p-5"
		method="POST"
		use:enhance={queuedJobToast({
			error: "Couldn't save the mailbox.",
			loading: "Saving the mailbox",
			onSettled: () => {
				saving = false;
			},
			onStart: () => {
				saving = true;
			},
			success: "Mailbox saved.",
		})}
	>
		{#if form?.error}
			<p class="text-sm text-red-500">{form.error}</p>
		{/if}
		<MailMailboxFields values={data.mailbox} />
	</form>
</section>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="Mail clients signed in with the old one have to sign in again."
		icon={KeyRound}
		title="Change the password"
	>
		{#snippet trailing()}
			<SaveButton
				disabled={!password}
				form="mailbox-password"
				pending={changingPassword}
			/>
		{/snippet}
	</PanelHeader>
	<form
		id="mailbox-password"
		action="?/password"
		class="p-5"
		method="POST"
		use:enhance={queuedJobToast({
			error: "Couldn't change the password.",
			loading: "Changing the password",
			onSettled: () => {
				changingPassword = false;
			},
			onStart: () => {
				changingPassword = true;
			},
			onSuccess: () => {
				password = "";
			},
			success: "Password changed.",
		})}
	>
		<PasswordField
			autocomplete="new-password"
			class="max-w-sm"
			id="mailNewPassword"
			label="New password"
			name="password"
			placeholder="At least 10 characters"
			bind:value={password}
		/>
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
			error: "Couldn't delete the mailbox.",
			loading: "Deleting the mailbox",
			success: "Mailbox deleted.",
		})}
	>
		<div>
			<p class="text-text text-sm font-medium">Delete this mailbox</p>
			<p class="text-text-muted mt-0.5 text-xs">
				The address stops receiving mail and everything it holds is wiped.
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

<ConfirmDialog
	bind:open={deleteDialogOpen}
	confirmLabel="Delete mailbox"
	confirmPhrase={data.mailbox.address}
	description={`Delete ${data.mailbox.address}? Its mail is wiped from the server. This can't be undone.`}
	onConfirm={() => deleteForm?.requestSubmit()}
	title="Delete mailbox"
/>
