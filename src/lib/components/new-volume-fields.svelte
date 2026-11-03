<script lang="ts">
	import { Input } from "@orochibraru/ui/input";
	import * as Select from "@orochibraru/ui/select";
	import { Textarea } from "@orochibraru/ui/textarea";

	import { formatBytes } from "#lib/formatting.js";
	import { getHostDisks } from "#lib/remote/volumes.remote.js";
	import { slugify } from "#lib/slug.js";

	let {
		idPrefix = "",
		kind = $bindable("volume"),
	}: {
		/** Prefixes the inputs' ids, for a page whose own form already uses `name` or `description`. */
		idPrefix?: string;
		kind?: "bind" | "volume";
	} = $props();

	let name = $state("");
	let source = $state("");
	let sourceEdited = $state(false);
	let disk = $state("");

	const DOCKER_DEFAULT = "docker";
	const hostDisks = getHostDisks();
	const disks = $derived(hostDisks.current ?? []);
	const chosenDisk = $derived(disks.find((d) => d.mountPoint === disk));
	const bindRoot = $derived(
		chosenDisk && chosenDisk.mountPoint !== "/"
			? chosenDisk.mountPoint
			: "/mnt/data",
	);

	const suggested = $derived(
		slugify(name)
			? kind === "bind"
				? `${bindRoot}/${slugify(name)}`
				: `homerun-${slugify(name)}`
			: "",
	);

	function diskLabel(mountPoint: string): string {
		const found = disks.find((d) => d.mountPoint === mountPoint);
		if (!found) {
			return "Docker's default location";
		}
		return `${found.mountPoint} · ${formatBytes(found.freeBytes)} free of ${formatBytes(found.totalBytes)}`;
	}

	$effect(() => {
		if (!sourceEdited) {
			source = suggested;
		}
	});

	const label = "block mb-1.5 text-sm font-medium text-text";
</script>

<!--
  Just the form fields : no <form> tag of its own, so each consumer wraps
  it in their own <form action=...> with their own use:enhance behavior
  (a full-page create-then-redirect on /storage/new, an in-place
  create-then-refresh in a modal on a service's Volumes tab). Same
  "shared chrome, not shared shape" split as $lib/server/form-styles.ts.
-->
<div>
	<label class={label} for="{idPrefix}name">
		Name <span class="text-red-500">*</span>
	</label>
	<Input
		id="{idPrefix}name"
		name="name"
		placeholder="e.g. Media library"
		required
		type="text"
		bind:value={name}
	/>
</div>

<div>
	<p class={label}>Type</p>
	<div class="grid grid-cols-2 gap-3">
		<label
			class="
        flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm transition-all {kind ===
			'volume'
				? 'border-accent bg-accent-light text-accent'
				: 'border-border text-text-muted'}
     "
		>
			<input
				class="sr-only"
				name="kind"
				type="radio"
				value="volume"
				bind:group={kind}
			/>
			Docker volume
		</label>
		<label
			class="
        flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm transition-all {kind ===
			'bind'
				? 'border-accent bg-accent-light text-accent'
				: 'border-border text-text-muted'}
     "
		>
			<input
				class="sr-only"
				name="kind"
				type="radio"
				value="bind"
				bind:group={kind}
			/>
			Host path
		</label>
	</div>
</div>

{#if disks.length > 1}
	<div>
		<p class={label}>Disk</p>
		<Select.Root
			type="single"
			bind:value={
				() => disk || DOCKER_DEFAULT,
				(value) => {
					disk = value === DOCKER_DEFAULT ? "" : value;
				}
			}
		>
			<Select.Trigger class="w-full">{diskLabel(disk)}</Select.Trigger>
			<Select.Content>
				<Select.Item label="Docker's default location" value={DOCKER_DEFAULT} />
				{#each disks as option (option.mountPoint)}
					<Select.Item
						label={diskLabel(option.mountPoint)}
						value={option.mountPoint}
					/>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if kind === "volume"}
			<input name="disk" type="hidden" value={disk} />
		{/if}
		<p class="text-text-subtle mt-1 text-xs">
			{#if kind === "bind"}
				Where the suggested host path goes. A host path can sit on any disk.
			{:else if disk}
				Kept in {disk}/homerun-volumes/&lt;volume name&gt; on this host. The
				disk can't be changed once the volume exists.
			{:else}
				Kept under Docker's data root, usually /var/lib/docker.
			{/if}
		</p>
	</div>
{/if}

<div>
	<label class={label} for="{idPrefix}source">
		{kind === "bind" ? "Host path" : "Volume name"}
		<span class="text-red-500">*</span>
	</label>
	<Input
		class=""
		id="{idPrefix}source"
		name="source"
		oninput={() => {
			sourceEdited = source !== "";
		}}
		placeholder={kind === "bind" ? "/mnt/data/media" : "homerun-media"}
		required
		type="text"
		bind:value={source}
	/>
	<p class="text-text-subtle mt-1 text-xs">
		{#if kind === "bind"}
			An absolute directory on this host : created automatically if it doesn't
			exist. Filled in from the name until you change it.
		{:else}
			A Docker-managed named volume : created automatically on first use. Filled
			in from the name until you change it.
		{/if}
	</p>
</div>

<div>
	<label class={label} for="{idPrefix}description">Description</label>
	<Textarea
		class="resize-none"
		id="{idPrefix}description"
		name="description"
		placeholder="Optional"
		rows={2}
	/>
</div>
