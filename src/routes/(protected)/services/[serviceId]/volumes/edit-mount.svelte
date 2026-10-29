<script lang="ts">
	import { enhance } from "$app/forms";
	import { refreshAll } from "$app/navigation";
	import { Pencil } from "@lucide/svelte";

	import CheckBox from "#lib/components/check-box.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { enhanceToast } from "#lib/toast.js";

	interface Props {
		mount: {
			containerPath: string;
			id: string;
			readOnly: boolean;
			volumeName: string;
		};
	}

	const { mount }: Props = $props();

	let open = $state(false);
	let duplicate = $state(false);
</script>

<Button
	onclick={() => {
		duplicate = false;
		open = true;
	}}
	size="icon-sm"
	title="Edit the mount"
	variant="ghost"
>
	<Pencil class="size-4" />
</Button>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit {mount.volumeName}</Dialog.Title>
			<Dialog.Description>Takes effect on the next deploy.</Dialog.Description>
		</Dialog.Header>

		<form
			action="?/updateMount"
			class="space-y-5"
			method="POST"
			use:enhance={enhanceToast({
				error: "Couldn't update the mount.",
				loading: "Updating the mount",
				onSuccess: () => {
					open = false;
					return refreshAll();
				},
				success: "Mount updated. Redeploy for it to take effect.",
			})}
		>
			<input name="mountId" type="hidden" value={mount.id} />

			<div>
				<label class={label} for="editContainerPath-{mount.id}">
					Mount path
				</label>
				<Input
					id="editContainerPath-{mount.id}"
					name="containerPath"
					placeholder="/data"
					required
					type="text"
					value={mount.containerPath}
				/>
			</div>

			<CheckBox
				checked={mount.readOnly}
				helperText="Mount this volume without write access"
				id="editReadOnly-{mount.id}"
				label="Read-only"
				name="readOnly"
			/>

			<CheckBox
				helperText="Mount a new copy of the volume instead, so the original stays as it is. The copy is made on the next deploy; stop the service first for a consistent copy of a database."
				id="editDuplicate-{mount.id}"
				label="Duplicate the volume first"
				name="duplicate"
				bind:checked={duplicate}
			/>

			{#if duplicate}
				<div>
					<label class={label} for="editCopyName-{mount.id}">
						Name of the copy
					</label>
					<Input
						id="editCopyName-{mount.id}"
						name="copyName"
						required
						type="text"
						value="{mount.volumeName} copy"
					/>
				</div>
			{/if}

			<Dialog.Footer>
				<Button
					onclick={() => {
						open = false;
					}}
					type="button"
					variant="outline"
				>
					Cancel
				</Button>
				<Button type="submit">Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
