<script lang="ts">
	import { untrack } from "svelte";
	import {
		DESTINATION_FIELDS,
		DESTINATION_PRESETS,
		DESTINATION_TYPE_LABELS,
		DESTINATION_TYPES,
		type DestinationSummary,
		type DestinationType,
	} from "$lib/backup-destinations";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";

	const CUSTOM = "custom";

	interface Props {
		destination?: DestinationSummary & { name: string };
	}

	const { destination }: Props = $props();

	const editing = $derived(destination !== undefined);
	let type = $state<DestinationType>(untrack(() => destination?.type ?? "s3"));
	let name = $state(untrack(() => destination?.name ?? ""));
	let endpoint = $state(untrack(() => destination?.endpoint ?? ""));
	let bucket = $state(untrack(() => destination?.bucket ?? ""));
	let region = $state(untrack(() => destination?.region ?? ""));
	let accessKeyId = $state(untrack(() => destination?.accessKeyId ?? ""));
	let presetId = $state(CUSTOM);
	const preset = $derived(
		DESTINATION_PRESETS.find((candidate) => candidate.id === presetId),
	);
	const fields = $derived(type === "s3" ? null : DESTINATION_FIELDS[type]);

	function applyPreset(id: string) {
		const picked = DESTINATION_PRESETS.find((candidate) => candidate.id === id);
		if (!picked) {
			return;
		}
		type = picked.type;
		endpoint = picked.endpoint ?? picked.endpointFor?.(accessKeyId) ?? "";
		region = picked.region ?? "";
		bucket = picked.path ?? "";
		name ||= picked.label;
	}

	function followUsername() {
		if (preset?.endpointFor) {
			endpoint = preset.endpointFor(accessKeyId.trim());
		}
	}
	const keepHint = $derived(editing ? "Leave blank to keep current" : "");
</script>

{#if !editing}
    <div>
        <label class={label} for="preset">Preset</label>
        <SelectRoot
            onValueChange={applyPreset}
            type="single"
            bind:value={presetId}
        >
            <SelectTrigger class="w-full sm:w-80" id="preset">
                {preset?.label ?? "Custom"}
            </SelectTrigger>
            <SelectContent>
                <SelectItem label="Custom" value={CUSTOM} />
                {#each DESTINATION_PRESETS as option (option.id)}
                    <SelectItem label={option.label} value={option.id} />
                {/each}
            </SelectContent>
        </SelectRoot>
    </div>
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
            bind:value={name}
        />
    </div>
    <div>
        <label class={label} for="type">Type</label>
        {#if editing}
            <Input
                disabled
                id="type"
                type="text"
                value={DESTINATION_TYPE_LABELS[type]}
            />
        {:else}
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
        {/if}
    </div>
</div>
{#if preset?.hint ?? fields?.hint}
    <p class="text-text-muted text-xs">{preset?.hint ?? fields?.hint}</p>
{/if}
<div>
    <label class={label} for="endpoint">
        {fields?.endpointLabel ?? "Endpoint"}
    </label>
    <Input
        id="endpoint"
        name="endpoint"
        placeholder={preset?.endpointPlaceholder
          ?? fields?.endpointPlaceholder
          ?? "https://s3.us-east-1.amazonaws.com"}
        required
        type="text"
        bind:value={endpoint}
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
            bind:value={bucket}
        />
    </div>
{:else}
    <div class="grid gap-4 sm:grid-cols-2">
        <div>
            <label class={label} for="bucket">Bucket</label>
            <Input
                id="bucket"
                name="bucket"
                required
                type="text"
                bind:value={bucket}
            />
        </div>
        <div>
            <label class={label} for="region">Region</label>
            <Input
                id="region"
                name="region"
                placeholder="us-east-1"
                required
                type="text"
                bind:value={region}
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
            oninput={followUsername}
            type="text"
            bind:value={accessKeyId}
        />
    </div>
    <div>
        <label class={label} for="secretAccessKey">
            {fields ? "Password" : "Secret access key"}
        </label>
        <Input
            id="secretAccessKey"
            name="secretAccessKey"
            placeholder={keepHint}
            required={!editing && type !== "sftp"}
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
            placeholder={keepHint
              || "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
            rows={6}
        />
        <p class="text-text-subtle mt-1 text-xs">
            An unencrypted key, without a passphrase.
        </p>
    </div>
{/if}
