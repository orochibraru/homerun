<script lang="ts">
	import { Plus, X } from "@lucide/svelte";

	import { labelClass as label } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import {
		Select as SelectRoot,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from "#lib/components/ui/select/index.js";
	import type { ExposedPort } from "#lib/published-ports.js";

	interface Props {
		name?: string;
		ports?: ExposedPort[];
	}

	const { name = "exposedPorts", ports = [] }: Props = $props();

	interface Row {
		port: string;
		protocol: "tcp" | "udp";
	}

	let rows = $state<Row[]>([]);

	$effect.pre(() => {
		rows = ports.map((port) => ({
			port: String(port.port),
			protocol: port.protocol,
		}));
	});

	const payload = $derived(
		JSON.stringify(
			rows.map((row) => ({ port: Number(row.port), protocol: row.protocol })),
		),
	);

	function addRow() {
		rows = [...rows, { port: "", protocol: "tcp" }];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}
</script>

<div class="space-y-3">
	<input {name} type="hidden" value={payload} />

	{#if rows.length === 0}
		<p class="text-text-subtle text-xs">
			Nothing exposed beyond the main port.
		</p>
	{:else}
		<div class="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
			<span class={label}>Container port</span>
			<span class={label}>Protocol</span>
			<span></span>
			{#each rows as row, index (index)}
				<Input
					aria-label="Container port"
					max="65535"
					min="1"
					placeholder="8088"
					required
					type="number"
					bind:value={row.port}
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
