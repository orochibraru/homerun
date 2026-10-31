<script lang="ts">
	import { Check, ChevronsUpDown } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import * as Command from "@orochibraru/ui/command";
	import * as InputGroup from "@orochibraru/ui/input-group";
	import * as Popover from "@orochibraru/ui/popover";
	import { Spinner } from "@orochibraru/ui/spinner";

	import { tagFamilies, tagFamily } from "#lib/image-versions.js";
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
	let shown = $state<string[]>([]);

	const families = $derived(tagFamilies(tags));
	const visible = $derived(
		shown.length > 0
			? tags.filter((value) => shown.includes(tagFamily(value)))
			: tags,
	);

	function toggleFamily(family: string) {
		shown = shown.includes(family)
			? shown.filter((other) => other !== family)
			: [...shown, family];
	}

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
			<Popover.Content align="end" class="w-80 p-0">
				{#if families.length > 1}
					<div
						class="border-border flex max-h-28 flex-wrap gap-1 overflow-y-auto border-b p-2"
					>
						{#each families as { count, family } (family)}
							<Button
								aria-pressed={shown.includes(family)}
								onclick={() => toggleFamily(family)}
								size="xs"
								type="button"
								variant={shown.includes(family) ? "default" : "outline"}
							>
								<span class="font-mono">{family}</span>
								<span class="opacity-60">{count}</span>
							</Button>
						{/each}
					</div>
				{/if}
				<Command.Root>
					<Command.Input placeholder="Filter tags…" />
					<Command.List>
						<Command.Empty>No tag matches.</Command.Empty>
						{#if visible.length > 0}
							<Command.Group>
								{#each visible as value (value)}
									<Command.Item onSelect={() => pick(value)} {value}>
										<Check class="size-4 {tag === value ? '' : 'opacity-0'}" />
										<span class="truncate">{value}</span>
									</Command.Item>
								{/each}
							</Command.Group>
						{/if}
					</Command.List>
				</Command.Root>
			</Popover.Content>
		</Popover.Root>
	</InputGroup.Addon>
</InputGroup.Root>
