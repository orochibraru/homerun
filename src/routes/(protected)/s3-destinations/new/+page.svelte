<script lang="ts">
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	onMount(() => title.set("New S3 Destination"));

	let submitting = $state(false);
</script>

<div class="p-6 md:p-8">
    <div class="mb-8">
        <h1 class="text-text text-xl font-semibold tracking-tight">Add an S3 destination</h1>
        <p class="mt-1 text-sm text-text-muted">
            Any S3-compatible bucket (AWS S3, MinIO, R2, Backblaze B2). Pick it
            from any volume's backup config once it's added here.
        </p>
    </div>

    <form
        action="?/create"
        class="mb-6 space-y-4 rounded-2xl glass p-5"
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
          onSuccess: () =>
            goto(resolve("/s3-destinations"), {
              invalidateAll: true,
            }),
          success: "Destination added.",
        })}
    >
        {#if form?.error}
            <p class="text-sm text-red-500">{form.error}</p>
        {/if}
        <div>
            <label class={label} for="name">Name</label>
            <Input
                id="name"
                name="name"
                placeholder="Backblaze B2"
                required
                type="text"
            />
        </div>
        <div>
            <label class={label} for="endpoint">Endpoint</label>
            <Input
                class="font-mono"
                id="endpoint"
                name="endpoint"
                placeholder="https://s3.us-east-1.amazonaws.com"
                required
                type="text"
            />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
            <div>
                <label class={label} for="bucket">Bucket</label>
                <Input id="bucket" name="bucket" required type="text" />
            </div>
            <div>
                <label class={label} for="region">Region</label>
                <Input
                    id="region"
                    name="region"
                    placeholder="us-east-1"
                    required
                    type="text"
                />
            </div>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
            <div>
                <label class={label} for="accessKeyId">Access key ID</label>
                <Input
                    id="accessKeyId"
                    name="accessKeyId"
                    required
                    type="text"
                />
            </div>
            <div>
                <label class={label} for="secretAccessKey"
                    >Secret access key</label
                >
                <Input
                    id="secretAccessKey"
                    name="secretAccessKey"
                    required
                    type="password"
                />
            </div>
        </div>

        <div class="flex justify-end gap-3">
            <Button disabled={submitting} type="submit" variant="outline">
                Add destination
            </Button>
        </div>
    </form>
</div>
