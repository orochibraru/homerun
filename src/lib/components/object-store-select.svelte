<script lang="ts">
	import * as Select from "#lib/components/ui/select/index.js";

	interface Props {
		id?: string;
		name: string;
		stores: { id: string; name: string }[];
		value?: string;
	}

	let { id, name, stores, value = $bindable("") }: Props = $props();

	const selected = $derived(
		stores.find((store) => store.id === value)?.name ?? "Pick a store",
	);
</script>

<Select.Root {name} type="single" bind:value>
  <Select.Trigger class="w-full" {id}>{selected}</Select.Trigger>
  <Select.Content>
    {#each stores as store (store.id)}
      <Select.Item label={store.name} value={store.id} />
    {/each}
  </Select.Content>
</Select.Root>
