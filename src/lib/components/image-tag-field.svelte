<script lang="ts">
	import { Check, ChevronsUpDown } from "@lucide/svelte";

	import * as Command from "#lib/components/ui/command/index.js";
	import * as InputGroup from "#lib/components/ui/input-group/index.js";
	import * as Popover from "#lib/components/ui/popover/index.js";
	import Spinner from "#lib/components/ui/spinner/spinner.svelte";
	import { listImageTags } from "#lib/remote/image-check.remote.js";

	const DEBOUNCE_MS = 600;

	let {
		id = "tag",
		image,
		name = "tag",
		placeholder = "latest",
		registryUrl = "",
		registryUsername = "",
		serviceId,
		tag = $bindable(""),
	}: {
		id?: string;
		image: string;
		name?: string;
		placeholder?: string;
		registryUrl?: string;
		registryUsername?: string;
		serviceId?: string;
		tag?: string;
	} = $props();

	let tags = $state<string[]>([]);
	let loading = $state(false);
	let open = $state(false);

	$effect(() => {
		const args = {
			image: image.trim(),
			registryUrl,
			registryUsername,
			serviceId,
		};
		tags = [];
		if (!args.image) {
			loading = false;
			return;
		}
		loading = true;
		let stale = false;
		const timer = setTimeout(async () => {
			const found = await listImageTags(args).catch(() => []);
			if (!stale) {
				tags = found;
				loading = false;
			}
		}, DEBOUNCE_MS);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	});

	function pick(value: string) {
		tag = value;
		open = false;
	}
</script>

<InputGroup.Root>
	<InputGroup.Input {id} {name} {placeholder} type="text" bind:value={tag} />
	<InputGroup.Addon align="inline-end">
		<Popover.Root bind:open>
			<Popover.Trigger disabled={tags.length === 0}>
				{#snippet child({ props })}
					<InputGroup.Button
						{...props}
						aria-label="Pick a tag from the registry"
						size="icon-xs"
						title={loading
							? "Listing tags…"
							: tags.length
								? `${tags.length} tags in the registry`
								: "No tags found in the registry"}
					>
						{#if loading}
							<Spinner />
						{:else}
							<ChevronsUpDown />
						{/if}
					</InputGroup.Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content align="end" class="w-72 p-0">
				<Command.Root>
					<Command.Input placeholder="Filter tags…" />
					<Command.List>
						<Command.Empty>No tag matches.</Command.Empty>
						<Command.Group>
							{#each tags as value (value)}
								<Command.Item onSelect={() => pick(value)} {value}>
									<Check class="size-4 {tag === value ? '' : 'opacity-0'}" />
									<span class="truncate">{value}</span>
								</Command.Item>
							{/each}
						</Command.Group>
					</Command.List>
				</Command.Root>
			</Popover.Content>
		</Popover.Root>
	</InputGroup.Addon>
</InputGroup.Root>
