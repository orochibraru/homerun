<script lang="ts">
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import BackupDestinationFields from "$lib/components/backup-destination-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	onMount(() => title.set("New Backup Destination"));

	let submitting = $state(false);
</script>

<div class="p-5 md:p-6">
    <div class="mb-8">
        <h1 class="text-text text-lg font-semibold tracking-tight">Add a backup destination</h1>
        <p class="mt-1 text-sm text-text-muted">
            An S3-compatible bucket (AWS S3, MinIO, R2, Backblaze B2), or a
            server reached over SFTP, SMB or WebDAV (a NAS, a Hetzner Storage
            Box). Pick it from any volume's backup config once it's added here.
        </p>
    </div>

    <form
        action="?/create"
        class="mb-6 space-y-4 rounded-md panel p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Check the form for errors.",
          loading: "Adding the destination",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          onSuccess: (data) =>
            goto(
              resolve("/(protected)/s3-destinations/[destinationId]", {
                destinationId: String(data?.destinationId),
              }),
              { invalidateAll: true },
            ),
          success: "Destination added.",
        })}
    >
        {#if form?.error}
            <p class="text-sm text-red-500">{form.error}</p>
        {/if}
        <BackupDestinationFields />

        <div class="flex justify-end gap-3">
            <Button disabled={submitting} type="submit" variant="outline">
                Add destination
            </Button>
        </div>
    </form>
</div>
