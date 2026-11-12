<script lang="ts">
	import { enhance } from "$app/forms";
	import { Button } from "@zedensix/ui/button";

	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import MailDomainSelect from "#lib/components/mail-domain-select.svelte";
	import MailMailboxFields from "#lib/components/mail-mailbox-fields.svelte";
	import PasswordField from "#lib/components/password-field.svelte";
	import { MAIL_MAILBOX_KINDS } from "#lib/mail.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data, form } = $props();

	let domainId = $state("");
	$effect(() => {
		domainId ||= data.domains[0]?.id ?? "";
	});
	let password = $state("");
	let submitting = $state(false);
	let kind = $state<"mailbox" | "noreply">("mailbox");

	const domainName = $derived(
		data.domains.find((domain) => domain.id === domainId)?.name ?? "",
	);
</script>

<form
	action="?/create"
	class="panel space-y-4 rounded-md p-5"
	method="POST"
	use:enhance={enhanceToast({
		error: "Couldn't add the mailbox.",
		loading: "Adding the mailbox",
		onSettled: () => {
			submitting = false;
		},
		onStart: () => {
			submitting = true;
		},
		success: "Address added. The mail server picks it up in a moment.",
	})}
>
	<div>
		<h2 class="text-text text-sm font-semibold">Add an address</h2>
		<p class="text-text-muted mt-1 text-xs">
			{kind === "noreply"
				? "Apps sign in to SMTP with the full address and this password to send from it. Mail sent to it is refused."
				: "People sign in to it with the full address and this password, over IMAP and SMTP."}
		</p>
	</div>
	{#if form?.error}
		<p class="text-sm text-red-500">{form.error}</p>
	{/if}
	<fieldset class="grid gap-2 sm:grid-cols-2">
		<legend class="sr-only">Category</legend>
		{#each MAIL_MAILBOX_KINDS as option (option.value)}
			<label
				class="flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition-all {kind ===
				option.value
					? 'border-accent bg-accent-light text-accent'
					: 'border-border text-text-muted'}"
			>
				<input
					class="sr-only"
					name="kind"
					type="radio"
					value={option.value}
					bind:group={kind}
				/>
				<span class="font-medium">{option.label}</span>
				<span class="text-text-muted text-xs">{option.description}</span>
			</label>
		{/each}
	</fieldset>
	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label class={labelClass} for="mailLocalPart">Address</label>
			<div class="flex items-center gap-2">
				<input
					id="mailLocalPart"
					class={inputClass}
					autocomplete="off"
					name="localPart"
					placeholder={kind === "noreply" ? "noreply" : "jane"}
					required
				/>
				<span class="text-text-muted shrink-0 text-sm">@{domainName}</span>
			</div>
		</div>
		<MailDomainSelect domains={data.domains} bind:value={domainId} />
	</div>
	<PasswordField
		autocomplete="new-password"
		id="mailPassword"
		label="Password"
		name="password"
		placeholder="At least 10 characters"
		required
		bind:value={password}
	/>
	<MailMailboxFields
		{kind}
		owners={data.owners}
		values={{ displayName: null, enabled: true, ownerId: null, quotaMb: null }}
	/>
	<div class="flex justify-end">
		<Button disabled={submitting} type="submit" variant="outline"
			>{kind === "noreply" ? "Add noreply address" : "Add mailbox"}</Button
		>
	</div>
</form>
