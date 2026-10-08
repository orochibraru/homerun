<script lang="ts">
	import { KeyRound, Trash2 } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import CopyBox from "#lib/components/copy-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import type { GarageBucketKey } from "#lib/services/s3/garage-admin.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	interface Props {
		createdKey: {
			accessKeyId: string;
			name: string;
			secretAccessKey: string;
		} | null;
		endpoint: string;
		keys: GarageBucketKey[] | null;
		region: string;
	}

	const { createdKey, endpoint, keys, region }: Props = $props();

	let name = $state("");
	let read = $state(true);
	let write = $state(true);
	let owner = $state(false);
	let confirmOpen = $state(false);
	let confirmTitle = $state("");
	let confirmForm: HTMLFormElement | null = null;

	function requestConfirm(event: MouseEvent, heading: string) {
		confirmForm = (event.currentTarget as HTMLElement).closest("form");
		confirmTitle = heading;
		confirmOpen = true;
	}

	function permissionsLabel(key: GarageBucketKey): string {
		const granted = [
			key.permissions.read ? "read" : null,
			key.permissions.write ? "write" : null,
			key.permissions.owner ? "owner" : null,
		].filter(Boolean);
		return granted.length > 0 ? granted.join(", ") : "no access";
	}
</script>

<section class="panel rounded-md">
  <PanelHeader
    description={keys === null
      ? "This store's keys are managed in its provider's console."
      : "Keys scoped to this bucket only. A key's secret is shown once, when it's created."}
    icon={KeyRound}
    title="Access keys"
  />
  {#if keys !== null}
    <div class="space-y-5 px-5 py-4">
      {#if createdKey}
        <div class="border-accent/40 rounded-lg border p-4">
          <p class="text-text text-sm font-medium">{createdKey.name} is ready</p>
          <p class="text-text-muted mt-1 mb-3 text-sm">
            This is the only time the secret is shown.
          </p>
          <CopyBox
            value={`AWS_ACCESS_KEY_ID=${createdKey.accessKeyId}\nAWS_SECRET_ACCESS_KEY=${createdKey.secretAccessKey}\nAWS_REGION=${region}\nAWS_ENDPOINT_URL=${endpoint}`}
          />
        </div>
      {/if}

      <form
        action="?/createKey"
        class="space-y-3"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't create that key.",
          loading: "Creating the key",
          onSuccess: () => {
            name = "";
          },
          success: "Key created.",
        })}
      >
        <div class="max-w-sm">
          <label class={labelClass} for="keyName">Name</label>
          <input
            id="keyName"
            class={inputClass}
            autocomplete="off"
            name="name"
            placeholder="ci-uploads"
            required
            bind:value={name}
          />
        </div>
        <div class="grid gap-2 sm:grid-cols-3">
          <CheckBox
            helperText="List and download objects."
            id="keyRead"
            label="Read"
            name="read"
            bind:checked={read}
          />
          <CheckBox
            helperText="Upload and delete objects."
            id="keyWrite"
            label="Write"
            name="write"
            bind:checked={write}
          />
          <CheckBox
            helperText="Change the bucket's settings, lifecycle included."
            id="keyOwner"
            label="Owner"
            name="owner"
            bind:checked={owner}
          />
        </div>
        <Button disabled={!name || !(read || write || owner)} type="submit">
          Create key
        </Button>
      </form>

      {#if keys.length > 0}
        <ul class="border-border divide-border divide-y rounded-lg border">
          {#each keys as key (key.accessKeyId)}
            <li class="flex items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="text-text text-sm font-medium">
                  {key.name || key.accessKeyId}
                </p>
                <p class="text-text-muted mt-0.5 font-mono text-xs">
                  {key.accessKeyId} · {permissionsLabel(key)}
                </p>
              </div>
              <form
                action="?/revokeKey"
                method="POST"
                use:enhance={enhanceToast({
                  error: "Couldn't revoke that key.",
                  loading: "Revoking the key",
                  success: "Key revoked.",
                })}
              >
                <input name="accessKeyId" type="hidden" value={key.accessKeyId} />
                <Button
                  onclick={(event: MouseEvent) =>
                    requestConfirm(event, `Revoke ${key.name || key.accessKeyId}?`)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 class="size-3.5" />
                  Revoke
                </Button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Revoke"
  description="The key is deleted on the store, so anything using it loses access to every bucket straight away."
  onConfirm={() => confirmForm?.requestSubmit()}
  title={confirmTitle}
/>
