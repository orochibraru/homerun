<script lang="ts">
	import CheckBox from "#lib/components/check-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";

	interface Props {
		values: { destinations: string[]; enabled: boolean };
	}

	const { values }: Props = $props();

	let enabled = $state(true);
	$effect(() => {
		enabled = values.enabled;
	});
</script>

<div>
	<label class={labelClass} for="mailDestinations">Forward to</label>
	<textarea
		id="mailDestinations"
		class="{inputClass} font-mono"
		name="destinations"
		placeholder={"jane@example.com\nops@example.org"}
		required
		rows="3"
		value={values.destinations.join("\n")}></textarea>
	<p class="text-text-subtle mt-1.5 text-xs">
		One address per line, on this server or anywhere else.
	</p>
</div>
<CheckBox
	helperText="A disabled alias stops forwarding; mail to it bounces unless a catch-all takes it."
	id="mailAliasEnabled"
	label="Enabled"
	name="enabled"
	bind:checked={enabled}
/>
