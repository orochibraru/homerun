<script lang="ts">
	import { enhance } from "$app/forms";
	import { Button } from "@zedensix/ui/button";

	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import MailAliasFields from "#lib/components/mail-alias-fields.svelte";
	import MailDomainSelect from "#lib/components/mail-domain-select.svelte";
	import { enhanceToast } from "#lib/toast.js";

	const { data, form } = $props();

	let domainId = $state("");
	$effect(() => {
		domainId ||= data.domains[0]?.id ?? "";
	});
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
		error: "Couldn't add the alias.",
		loading: "Adding the alias",
		onSettled: () => {
			submitting = false;
		},
		onStart: () => {
			submitting = true;
		},
		success: "Alias added.",
	})}
>
	<div>
		<h2 class="text-text text-sm font-semibold">Add an alias</h2>
		<p class="text-text-muted mt-1 text-xs">
			Leave the name empty to catch every address on the domain that isn't a
			mailbox or another alias.
		</p>
	</div>
	{#if form?.error}
		<p class="text-sm text-red-500">{form.error}</p>
	{/if}
	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label class={labelClass} for="mailAliasLocalPart">Address</label>
			<div class="flex items-center gap-2">
				<input
					id="mailAliasLocalPart"
					class={inputClass}
					autocomplete="off"
					name="localPart"
					placeholder="hello (empty for a catch-all)"
				/>
				<span class="text-text-muted shrink-0 text-sm">@{domainName}</span>
			</div>
		</div>
		<MailDomainSelect domains={data.domains} bind:value={domainId} />
	</div>
	<MailAliasFields values={{ destinations: [], enabled: true }} />
	<div class="flex justify-end">
		<Button disabled={submitting} type="submit" variant="outline"
			>Add alias</Button
		>
	</div>
</form>
