<script lang="ts">
	import { enhance } from "$app/forms";
	import { AtSign } from "@lucide/svelte";

	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import PasswordField from "#lib/components/password-field.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { enhanceToast } from "#lib/toast.js";

	const { data } = $props();

	let passwords = $state<Record<string, string>>({});
	let saving = $state<Record<string, boolean>>({});
	const host = $derived(data.hostname ?? "mail.example.com");
</script>

{#if data.mailboxes.length === 0}
	<EmptyState
		icon={AtSign}
		subtitle="An admin can make you a mailbox's owner from its settings on the Mail page, then its password is yours to change here."
		title="No mailbox of yours"
	/>
{:else}
	{#each data.mailboxes as mailbox (mailbox.id)}
		<section class="panel mb-6 rounded-md">
			<PanelHeader
				description={mailbox.kind === "noreply"
					? `A send-only address: apps sign in to SMTP at ${host} with it. Change the password in those apps too.`
					: `Sign in at ${host}: IMAP on 993, SMTP on 465 or 587. Mail apps signed in with the old password have to sign in again.`}
				icon={AtSign}
				title={mailbox.address}
			>
				{#snippet trailing()}
					<SaveButton
						disabled={!passwords[mailbox.id]}
						form="mailbox-password-{mailbox.id}"
						label="Change password"
						pending={saving[mailbox.id] ?? false}
					/>
				{/snippet}
			</PanelHeader>
			<form
				id="mailbox-password-{mailbox.id}"
				action="?/password"
				class="p-5"
				method="POST"
				use:enhance={enhanceToast({
					error: "Couldn't change the password.",
					loading: "Changing the password",
					onSettled: () => {
						saving[mailbox.id] = false;
					},
					onStart: () => {
						saving[mailbox.id] = true;
					},
					onSuccess: () => {
						passwords[mailbox.id] = "";
					},
					success: "Password changed. The mail server picks it up in a moment.",
				})}
			>
				<input name="mailboxId" type="hidden" value={mailbox.id} />
				<PasswordField
					autocomplete="new-password"
					id="mailboxPassword-{mailbox.id}"
					label="New password"
					name="password"
					placeholder="At least 10 characters"
					bind:value={passwords[mailbox.id]}
				/>
			</form>
		</section>
	{/each}
{/if}
