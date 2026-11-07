<script lang="ts">
	import CheckBox from "#lib/components/check-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";

	interface Props {
		values: {
			displayName: string | null;
			enabled: boolean;
			quotaMb: number | null;
		};
	}

	const { values }: Props = $props();

	let enabled = $state(true);
	$effect(() => {
		enabled = values.enabled;
	});
</script>

<div class="grid gap-4 sm:grid-cols-2">
	<div>
		<label class={labelClass} for="mailDisplayName">Display name</label>
		<input
			id="mailDisplayName"
			class={inputClass}
			autocomplete="off"
			name="displayName"
			placeholder="Jane Doe"
			value={values.displayName ?? ""}
		/>
	</div>
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
</div>
<CheckBox
	helperText="A disabled mailbox can't sign in and its address stops receiving mail. What it holds is kept."
	id="mailEnabled"
	label="Enabled"
	name="enabled"
	bind:checked={enabled}
/>
