<script lang="ts">
	import { enhance } from "$app/forms";
	import { Button } from "@orochibraru/ui/button";

	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import { enhanceToast } from "#lib/toast.js";

	const { form } = $props();

	let submitting = $state(false);
</script>

<form
	action="?/create"
	class="panel space-y-4 rounded-md p-5"
	method="POST"
	use:enhance={enhanceToast({
		error: "Couldn't add the domain.",
		loading: "Adding the domain and generating its DKIM key",
		onSettled: () => {
			submitting = false;
		},
		onStart: () => {
			submitting = true;
		},
		success: "Domain added. Publish its DNS records next.",
	})}
>
	<div>
		<h2 class="text-text text-sm font-semibold">Add a mail domain</h2>
		<p class="text-text-muted mt-1 text-xs">
			Addresses on it are delivered to this server once its MX record points
			here. A DKIM key is generated for it.
		</p>
	</div>
	{#if form?.error}
		<p class="text-sm text-red-500">{form.error}</p>
	{/if}
	<div>
		<label class={labelClass} for="mailDomainName">Domain</label>
		<input
			id="mailDomainName"
			class="{inputClass} max-w-sm"
			autocomplete="off"
			name="name"
			placeholder="example.com"
			required
		/>
	</div>
	<div class="flex justify-end">
		<Button disabled={submitting} type="submit" variant="outline"
			>Add domain</Button
		>
	</div>
</form>
