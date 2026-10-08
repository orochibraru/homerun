<script lang="ts">
	import { ArrowLeft, KeyRound, Plus } from "@lucide/svelte";
	import { onMount } from "svelte";
	import Alert from "#lib/components/alert.svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import CopyBox from "#lib/components/copy-box.svelte";
	import PermissionPicker from "#lib/components/permission-picker.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import * as Select from "#lib/components/ui/select/index.js";
	import Spinner from "#lib/components/ui/spinner/spinner.svelte";
	import {
		API_KEY_EXPIRY_OPTIONS,
		type ApiKeyExpiry,
		DEFAULT_API_KEY_EXPIRY,
		type Permissions,
	} from "#lib/permissions.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data, form } = $props();

	onMount(() => title.set("New API key"));

	let newKeyName = $state("");
	let newKeyExpiry = $state<ApiKeyExpiry>(DEFAULT_API_KEY_EXPIRY);
	const newKeyExpiryLabel = $derived(
		API_KEY_EXPIRY_OPTIONS.find((option) => option.value === newKeyExpiry)
			?.label ?? "",
	);
	let newKeyAllPermissions = $state(false);
	let newKeyPermissions = $state<Permissions>({});
	let creating = $state(false);
</script>

<div class="space-y-6">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/profile/api-keys")}
  >
    <ArrowLeft class="size-4" />
    All API keys
  </a>

  {#if form?.success && "key" in form && form.key}
    <div class="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <p class="font-semibold text-emerald-800 dark:text-emerald-400">
        API key created
      </p>
      <p class="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
        Copy it now : it won't be shown again.
      </p>
      <CopyBox
        class="mt-2 border-emerald-200 bg-surface dark:border-emerald-900/40"
        label="the API key"
        value={form.key}
      />
    </div>
    <Button href={resolve("/(protected)/profile/api-keys")} variant="outline">
      <ArrowLeft class="size-4" />
      Back to API keys
    </Button>
  {:else}
  <section class="rounded-md panel">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div class="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <KeyRound class="size-4" />
      </div>
      <div>
        <h2 class="eyebrow">New API key</h2>
        <p class="text-xs text-text-muted">
          For the Homerun CLI or your own scripts, sent as
          <code>x-api-key</code>. A key can only do what you can, narrowed to
          the permissions you pick for it.
        </p>
      </div>
    </div>

    <div class="p-5">
      <form
        action="?/create"
        class="space-y-4"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't create the key.",
          loading: "Creating the key",
          onSettled: () => {
            creating = false;
          },
          onStart: () => {
            creating = true;
          },
          success: "Key created.",
        })}
      >
        <div class="flex flex-wrap items-end gap-2">
          <div class="min-w-48 flex-1">
            <label class="mb-1.5 block text-sm font-medium text-text" for="name">
              New key name
            </label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. CI deploys"
              type="text"
              bind:value={newKeyName}
            />
          </div>
          <div>
            <div class="mb-1.5 block text-sm font-medium text-text">Expires</div>
            <Select.Root name="expiry" type="single" bind:value={newKeyExpiry}>
              <Select.Trigger aria-label="Expires" class="w-52">
                {newKeyExpiryLabel}
              </Select.Trigger>
              <Select.Content>
                {#each API_KEY_EXPIRY_OPTIONS as option (option.value)}
                  <Select.Item label={option.label} value={option.value}>
                    {option.label}
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </div>

        {#if newKeyExpiry === "never"}
          <Alert variant="warning">
            A key that never expires keeps working until you revoke it. Set an
            expiry unless something can't rotate it.
          </Alert>
        {/if}

        <CheckBox
          helperText="Dangerous: the key can do everything your account can, including whatever you're granted later. Pick only what it needs unless you really mean it."
          id="allPermissions"
          label="Allow all permissions"
          name="allPermissions"
          bind:checked={newKeyAllPermissions}
        />

        {#if !newKeyAllPermissions}
          <PermissionPicker grantable={data.grantable} bind:value={newKeyPermissions} />
        {/if}

        <div class="flex justify-end">
          <Button disabled={creating} type="submit">
            {#if creating}
              <Spinner />
            {:else}
              <Plus class="size-4" />
            {/if}
            Generate
          </Button>
        </div>
      </form>
    </div>

  </section>
  {/if}
</div>
