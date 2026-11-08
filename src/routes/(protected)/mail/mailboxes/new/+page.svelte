<script lang="ts">
	import { enhance } from "$app/forms";
	import { Button } from "@orochibraru/ui/button";

	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import MailDomainSelect from "#lib/components/mail-domain-select.svelte";
	import MailMailboxFields from "#lib/components/mail-mailbox-fields.svelte";
	import PasswordField from "#lib/components/password-field.svelte";
	import { enhanceToast } from "#lib/toast.js";

	const { data, form } = $props();

	let domainId = $state("");
	$effect(() => {
		domainId ||= data.domains[0]?.id ?? "";
	});
	let password = $state("");
	let submitting = $state(false);

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
		success: "Mailbox added. The mail server picks it up in a moment.",
	})}
>
	<div>
		<h2 class="text-text text-sm font-semibold">Add a mailbox</h2>
		<p class="text-text-muted mt-1 text-xs">
			People sign in to it with the full address and this password, over IMAP
			and SMTP.
		</p>
	</div>
	{#if form?.error}
		<p class="text-sm text-red-500">{form.error}</p>
	{/if}
	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label class={labelClass} for="mailLocalPart">Address</label>
			<div class="flex items-center gap-2">
				<input
					id="mailLocalPart"
					class={inputClass}
					autocomplete="off"
					name="localPart"
					placeholder="jane"
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
		values={{ displayName: null, enabled: true, quotaMb: null }}
	/>
	<div class="flex justify-end">
		<Button disabled={submitting} type="submit" variant="outline"
			>Add mailbox</Button
		>
	</div>
</form>
