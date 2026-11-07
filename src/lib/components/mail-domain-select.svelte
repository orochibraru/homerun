<script lang="ts">
	import * as Select from "@orochibraru/ui/select";

	import { labelClass } from "#lib/components/form-styles.js";

	interface Props {
		domains: { id: string; name: string }[];
		value: string;
	}

	let { domains, value = $bindable() }: Props = $props();

	const selected = $derived(
		domains.find((domain) => domain.id === value)?.name ?? "Pick a domain",
	);
</script>

<div>
	<label class={labelClass} for="mailDomain">Domain</label>
	<Select.Root name="domainId" type="single" bind:value>
		<Select.Trigger class="w-full" id="mailDomain">{selected}</Select.Trigger>
		<Select.Content>
			{#each domains as domain (domain.id)}
				<Select.Item label={domain.name} value={domain.id} />
			{/each}
		</Select.Content>
	</Select.Root>
</div>
