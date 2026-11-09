<script lang="ts">
	import * as Select from "@orochibraru/ui/select";

	import CheckBox from "#lib/components/check-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";

	interface Props {
		kind: "mailbox" | "noreply";
		owners: { email: string; id: string; name: string }[];
		values: {
			displayName: string | null;
			enabled: boolean;
			ownerId: string | null;
			quotaMb: number | null;
		};
	}

	const { kind, owners, values }: Props = $props();

	let enabled = $state(true);
	const NOBODY = "nobody";
	let ownerId = $state(NOBODY);
	$effect(() => {
		enabled = values.enabled;
		ownerId = values.ownerId ?? NOBODY;
	});

	const ownerLabel = $derived.by(() => {
		const owner = owners.find((candidate) => candidate.id === ownerId);
		return owner ? `${owner.name} (${owner.email})` : "Nobody";
	});
</script>

<div class="grid gap-4 sm:grid-cols-3">
	<div>
		<label class={labelClass} for="mailDisplayName">Display name</label>
		<input
			id="mailDisplayName"
			class={inputClass}
			autocomplete="off"
			name="displayName"
			placeholder={kind === "noreply" ? "Example notifications" : "Jane Doe"}
			value={values.displayName ?? ""}
		/>
	</div>
	<div>
		<label class={labelClass} for="mailOwner">Owner</label>
		<input
			name="ownerId"
			type="hidden"
			value={ownerId === NOBODY ? "" : ownerId}
		/>
		<Select.Root type="single" bind:value={ownerId}>
			<Select.Trigger class="w-full" id="mailOwner">{ownerLabel}</Select.Trigger
			>
			<Select.Content>
				<Select.Item label="Nobody" value={NOBODY} />
				{#each owners as owner (owner.id)}
					<Select.Item
						label={`${owner.name} (${owner.email})`}
						value={owner.id}
					/>
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="text-text-muted mt-1 text-xs">
			Can change its password from their own account settings.
		</p>
	</div>
	{#if kind === "mailbox"}
		<div>
			<label class={labelClass} for="mailQuota">Quota (MB)</label>
			<input
				id="mailQuota"
				class={inputClass}
				min="1"
				name="quotaMb"
				placeholder="No quota"
				step="1"
				type="number"
				value={values.quotaMb ?? ""}
			/>
		</div>
	{/if}
</div>
<CheckBox
	helperText={kind === "noreply"
		? "A disabled noreply address can't sign in, so apps can't send from it."
		: "A disabled mailbox can't sign in and its address stops receiving mail. What it holds is kept."}
	id="mailEnabled"
	label="Enabled"
	name="enabled"
	bind:checked={enabled}
/>
