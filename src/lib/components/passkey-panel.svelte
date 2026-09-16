<script lang="ts">
	import { Fingerprint, Plus, Trash2 } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { invalidateAll } from "$app/navigation";
	import { authClient } from "$lib/auth-client";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { toastError } from "$lib/toast";

	interface PasskeyRow {
		backedUp: boolean;
		createdAt: Date | null;
		deviceType: string;
		id: string;
		name: string | null;
	}

	interface Props {
		onChange?: () => Promise<void> | void;
		passkeys: PasskeyRow[];
	}

	const { passkeys, onChange = invalidateAll }: Props = $props();

	let name = $state("");
	let busy = $state(false);
	let pendingDelete = $state<PasskeyRow | null>(null);
	let confirmOpen = $state(false);

	async function addCallback(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const { error } = await authClient.passkey.addPasskey({
				name: name.trim() || undefined,
			});
			if (error) {
				throw new Error(error.message ?? "Couldn't register that passkey.");
			}
			name = "";
			await onChange();
		} finally {
			busy = false;
		}
	}

	function handleAdd(e: SubmitEvent) {
		return toast.promise(addCallback(e), {
			error: (err) => toastError(err, "Couldn't register that passkey."),
			loading: "Waiting for your passkey",
			success: "Passkey added.",
		});
	}

	async function deleteCallback(id: string) {
		busy = true;
		try {
			const { error } = await authClient.passkey.deletePasskey({ id });
			if (error) {
				throw new Error(error.message ?? "Couldn't remove that passkey.");
			}
			await onChange();
		} finally {
			busy = false;
		}
	}

	function handleDelete() {
		const target = pendingDelete;
		if (!target) {
			return;
		}
		pendingDelete = null;
		return toast.promise(deleteCallback(target.id), {
			error: (err) => toastError(err, "Couldn't remove that passkey."),
			loading: "Removing passkey",
			success: "Passkey removed.",
		});
	}

	function formatDate(value: Date | null): string {
		return value ? new Date(value).toLocaleDateString() : "unknown date";
	}
</script>

<div class="space-y-4">
  {#if passkeys.length > 0}
    <div class="divide-border border-border divide-y rounded-lg border">
      {#each passkeys as key (key.id)}
        <div class="flex items-center gap-3 px-3 py-2.5">
          <div
            class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg"
          >
            <Fingerprint class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-sm font-medium">
              {key.name || "Unnamed passkey"}
            </p>
            <p class="text-text-subtle text-xs">
              Added {formatDate(key.createdAt)}
              · {key.deviceType === "multiDevice" ? "synced" : "this device only"}
            </p>
          </div>
          <Button
            aria-label="Remove passkey"
            disabled={busy}
            onclick={() => {
              pendingDelete = key;
              confirmOpen = true;
            }}
            size="icon-sm"
            variant="ghost"
          >
            <Trash2 class="size-4" />
          </Button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-text-muted text-sm">No passkeys registered yet.</p>
  {/if}

  <form class="flex items-end gap-2" onsubmit={handleAdd}>
    <div class="flex-1">
      <label class="text-text mb-1.5 block text-sm font-medium" for="passkeyName">
        Name
      </label>
      <Input
        autocomplete="off"
        class="h-10"
        disabled={busy}
        id="passkeyName"
        placeholder="e.g. MacBook Touch ID"
        bind:value={name}
      />
    </div>
    <Button class="h-10" disabled={busy} type="submit">
      {#if busy}
        <Spinner />
      {:else}
        <Plus class="size-4" />
      {/if}
      Add passkey
    </Button>
  </form>
</div>

<ConfirmDialog
  confirmLabel="Remove"
  description="You won't be able to sign in with it anymore."
  onConfirm={handleDelete}
  title="Remove {pendingDelete?.name || 'this passkey'}?"
  bind:open={confirmOpen}
/>
