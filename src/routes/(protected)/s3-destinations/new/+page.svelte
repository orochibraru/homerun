<script lang="ts">
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		DESTINATION_FIELDS,
		DESTINATION_TYPE_LABELS,
		DESTINATION_TYPES,
		type DestinationType,
	} from "$lib/backup-destinations";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	onMount(() => title.set("New Backup Destination"));

	let submitting = $state(false);
	let type = $state<DestinationType>("s3");
	const fields = $derived(type === "s3" ? null : DESTINATION_FIELDS[type]);
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
        <div class="grid gap-4 sm:grid-cols-2">
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
                <label class={label} for="type">Type</label>
                <SelectRoot name="type" type="single" bind:value={type}>
                    <SelectTrigger class="w-full" id="type">
                        {DESTINATION_TYPE_LABELS[type]}
                    </SelectTrigger>
                    <SelectContent>
                        {#each DESTINATION_TYPES as option (option)}
                            <SelectItem
                                label={DESTINATION_TYPE_LABELS[option]}
                                value={option}
                            />
                        {/each}
                    </SelectContent>
                </SelectRoot>
            </div>
        </div>
        {#if fields}
            <p class="text-text-muted text-xs">{fields.hint}</p>
        {/if}
        <div>
            <label class={label} for="endpoint">
                {fields?.endpointLabel ?? "Endpoint"}
            </label>
            <Input
                id="endpoint"
                name="endpoint"
                placeholder={fields?.endpointPlaceholder
                  ?? "https://s3.us-east-1.amazonaws.com"}
                required
                type="text"
            />
        </div>
        {#if fields}
            <div>
                <label class={label} for="bucket">{fields.pathLabel}</label>
                <Input
                    id="bucket"
                    name="bucket"
                    placeholder={fields.pathPlaceholder}
                    required={fields.pathRequired}
                    type="text"
                />
            </div>
        {:else}
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
        {/if}
        <div class="grid gap-4 sm:grid-cols-2">
            <div>
                <label class={label} for="accessKeyId">
                    {fields ? "Username" : "Access key ID"}
                </label>
                <Input
                    id="accessKeyId"
                    name="accessKeyId"
                    required
                    type="text"
                />
            </div>
            <div>
                <label class={label} for="secretAccessKey">
                    {fields ? "Password" : "Secret access key"}
                </label>
                <Input
                    id="secretAccessKey"
                    name="secretAccessKey"
                    required={type !== "sftp"}
                    type="password"
                />
            </div>
        </div>
        {#if type === "sftp"}
            <div>
                <label class={label} for="privateKey">
                    Private key, instead of a password
                </label>
                <Textarea
                    class="font-mono text-xs"
                    id="privateKey"
                    name="privateKey"
                    placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
                    rows={6}
                />
                <p class="text-text-subtle mt-1 text-xs">
                    An unencrypted key, without a passphrase.
                </p>
            </div>
        {/if}

        <div class="flex justify-end gap-3">
            <Button disabled={submitting} type="submit" variant="outline">
                Add destination
            </Button>
        </div>
    </form>
</div>
