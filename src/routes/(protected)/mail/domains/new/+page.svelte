<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { Globe } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import * as Select from "@zedensix/ui/select";

	import EmptyState from "#lib/components/empty-state.svelte";
	import { labelClass } from "#lib/components/form-styles.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data, form } = $props();

	let dnsDomainId = $state("");
	$effect(() => {
		dnsDomainId ||= data.available[0]?.id ?? "";
	});
	let submitting = $state(false);

	const picked = $derived(
		data.available.find((domain) => domain.id === dnsDomainId),
	);
</script>

{#if data.available.length === 0}
	<EmptyState
		icon={Globe}
		subtitle="Mail domains come from the DNS page: add the domain there first, then come back."
		title="No domain left to add"
	>
		<Button href={resolve("dns")} variant="outline">Go to DNS</Button>
	</EmptyState>
{:else}
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
				Pick one of the domains on the
				<a class="text-accent underline" href={resolve("dns")}>DNS page</a>. Its
				addresses are delivered here once its MX record points at this server,
				and it gets a DKIM key.
			</p>
		</div>
		{#if form?.error}
			<p class="text-sm text-red-500">{form.error}</p>
		{/if}
		<div class="max-w-sm">
			<label class={labelClass} for="mailDnsDomain">Domain</label>
			<Select.Root name="dnsDomainId" type="single" bind:value={dnsDomainId}>
				<Select.Trigger class="w-full" id="mailDnsDomain">
					{picked?.name ?? "Pick a domain"}
				</Select.Trigger>
				<Select.Content>
					{#each data.available as domain (domain.id)}
						<Select.Item label={domain.name} value={domain.id} />
					{/each}
				</Select.Content>
			</Select.Root>
			{#if picked}
				<p class="text-text-subtle mt-1.5 text-xs">
					{picked.linked
						? "Linked to a DNS provider: Homerun can publish its mail records for you."
						: "Not linked to a DNS provider: you'll add its mail records by hand."}
				</p>
			{/if}
		</div>
		<div class="flex justify-end">
			<Button
				disabled={submitting || !dnsDomainId}
				type="submit"
				variant="outline">Add domain</Button
			>
		</div>
	</form>
{/if}
