<script lang="ts">
	import { Plus, X } from "@lucide/svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import type { PublishedPort } from "$lib/published-ports";

	interface Props {
		defaultContainerPort?: number | string;
		name?: string;
		ports?: PublishedPort[];
	}

	const {
		defaultContainerPort = "",
		name = "publishedPorts",
		ports = [],
	}: Props = $props();

	interface Row {
		containerPort: string;
		hostPort: string;
		protocol: "tcp" | "udp";
	}

	let rows = $state<Row[]>([]);

	$effect.pre(() => {
		rows = ports.map((port) => ({
			containerPort: String(port.containerPort),
			hostPort: String(port.hostPort),
			protocol: port.protocol,
		}));
	});

	const payload = $derived(
		JSON.stringify(
			rows.map((row) => ({
				containerPort: Number(row.containerPort),
				hostPort: Number(row.hostPort),
				protocol: row.protocol,
			})),
		),
	);

	function addRow() {
		rows = [
			...rows,
			{
				containerPort: String(defaultContainerPort),
				hostPort: "",
				protocol: "tcp",
			},
		];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}
</script>

<div class="space-y-3">
  <input {name} type="hidden" value={payload}>

  {#if rows.length === 0}
    <p class="text-text-subtle text-xs">Nothing published.</p>
  {:else}
    <div class="grid grid-cols-[1fr_1fr_8rem_auto] items-end gap-2">
      <span class={label}>Host port</span>
      <span class={label}>Container port</span>
      <span class={label}>Protocol</span>
      <span></span>
      {#each rows as row, index (index)}
        <Input
          aria-label="Host port"
          max="65535"
          min="1"
          placeholder="1194"
          required
          type="number"
          bind:value={row.hostPort}
        />
        <Input
          aria-label="Container port"
          max="65535"
          min="1"
          required
          type="number"
          bind:value={row.containerPort}
        />
        <SelectRoot type="single" bind:value={row.protocol}>
          <SelectTrigger aria-label="Protocol" class="w-full">
            {row.protocol.toUpperCase()}
          </SelectTrigger>
          <SelectContent>
            <SelectItem label="TCP" value="tcp" />
            <SelectItem label="UDP" value="udp" />
          </SelectContent>
        </SelectRoot>
        <Button
          aria-label="Remove this port"
          onclick={() => removeRow(index)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X class="size-4" />
        </Button>
      {/each}
    </div>
  {/if}

  <Button onclick={addRow} type="button" variant="outline">
    <Plus class="size-4" />
    Add port
  </Button>
</div>
