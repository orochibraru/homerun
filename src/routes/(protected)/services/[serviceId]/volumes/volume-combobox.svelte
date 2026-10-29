<script lang="ts">
	import { Check, ChevronsUpDown, FolderOpen, HardDrive } from "@lucide/svelte";

	import { Button } from "#lib/components/ui/button/index.js";
	import * as Command from "#lib/components/ui/command/index.js";
	import * as Popover from "#lib/components/ui/popover/index.js";
	import { HOST_VOLUME_PREFIX } from "#lib/constants.js";

	interface Props {
		hostVolumes: string[];
		id: string;
		name: string;
		value: string;
		volumes: { id: string; kind: string; name: string; source: string }[];
	}

	let {
		hostVolumes,
		id,
		name,
		value = $bindable(""),
		volumes,
	}: Props = $props();

	let open = $state(false);

	const picked = $derived(
		value.startsWith(HOST_VOLUME_PREFIX)
			? { name: value.slice(HOST_VOLUME_PREFIX.length), source: "" }
			: volumes.find((vol) => vol.id === value),
	);

	function pick(next: string) {
		value = next;
		open = false;
	}
</script>

<input {name} type="hidden" {value} />

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				class="w-full justify-between"
				{id}
				role="combobox"
				type="button"
				variant="outline"
			>
				{#if picked}
					<span class="truncate">{picked.name}</span>
				{:else}
					<span class="text-text-muted truncate">Select a volume</span>
				{/if}
				<ChevronsUpDown class="size-4 shrink-0 opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-(--bits-popover-anchor-width) min-w-72 p-0">
		<Command.Root>
			<Command.Input placeholder="Search volumes…" />
			<Command.List>
				<Command.Empty>No volume matches.</Command.Empty>
				{#if volumes.length > 0}
					<Command.Group heading="Storage">
						{#each volumes as vol (vol.id)}
							<Command.Item
								keywords={[vol.source]}
								onSelect={() => pick(vol.id)}
								value="{vol.name} {vol.id}"
							>
								<Check
									class="size-4 shrink-0 {value === vol.id ? '' : 'opacity-0'}"
								/>
								{#if vol.kind === "bind"}
									<FolderOpen class="text-text-muted size-4 shrink-0" />
								{:else}
									<HardDrive class="text-text-muted size-4 shrink-0" />
								{/if}
								<span class="flex min-w-0 flex-col">
									<span class="truncate">{vol.name}</span>
									<span
										class="text-text-subtle truncate font-mono text-[0.6875rem]"
									>
										{vol.source}
									</span>
								</span>
							</Command.Item>
						{/each}
					</Command.Group>
				{/if}
				{#if hostVolumes.length > 0}
					<Command.Group heading="On this machine">
						{#each hostVolumes as hostName (hostName)}
							{@const hostValue = `${HOST_VOLUME_PREFIX}${hostName}`}
							<Command.Item
								onSelect={() => pick(hostValue)}
								value="{hostName} {hostValue}"
							>
								<Check
									class="size-4 shrink-0 {value === hostValue
										? ''
										: 'opacity-0'}"
								/>
								<HardDrive class="text-text-muted size-4 shrink-0" />
								<span class="truncate">{hostName}</span>
							</Command.Item>
						{/each}
					</Command.Group>
				{/if}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
