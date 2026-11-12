<script lang="ts">
	import * as Select from "@zedensix/ui/select";

	import { formatBytes } from "#lib/formatting.js";
	import type { HostDisk } from "#lib/services/host-disk.service.js";

	let {
		disks,
		id,
		value = $bindable(""),
	}: {
		disks: HostDisk[];
		id?: string;
		/** The chosen disk's mount point, empty for Docker's default location. */
		value?: string;
	} = $props();

	const DOCKER_DEFAULT = "docker";

	function diskLabel(mountPoint: string): string {
		const found = disks.find((disk) => disk.mountPoint === mountPoint);
		if (!found) {
			return "Docker's default location";
		}
		return `${found.mountPoint} · ${formatBytes(found.freeBytes)} free of ${formatBytes(found.totalBytes)}`;
	}
</script>

<Select.Root
	type="single"
	bind:value={
		() => value || DOCKER_DEFAULT,
		(picked) => {
			value = picked === DOCKER_DEFAULT ? "" : picked;
		}
	}
>
	<Select.Trigger class="w-full" {id}>{diskLabel(value)}</Select.Trigger>
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
