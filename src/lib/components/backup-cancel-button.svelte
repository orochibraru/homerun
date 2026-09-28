<script lang="ts">
	import { CircleStop } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		kind: string;
		runId: string;
	}

	const { kind, runId }: Props = $props();

	let confirming = $state(false);
	let form = $state<HTMLFormElement | undefined>();
	const restore = $derived(kind === "restore");
</script>

<Button
  aria-label="Cancel this {restore ? 'restore' : 'backup'}"
  onclick={(event) => {
    event.stopPropagation();
    confirming = true;
  }}
  size="xs"
  variant="ghost"
>
  <CircleStop class="size-3.5" />
  Cancel
</Button>

<form
  action="?/cancelRun"
  class="hidden"
  method="POST"
  bind:this={form}
  use:enhance={enhanceToast({
    error: `Couldn't cancel the ${restore ? "restore" : "backup"}.`,
    loading: `Cancelling the ${restore ? "restore" : "backup"}`,
    success: `${restore ? "Restore" : "Backup"} cancelled.`,
  })}
>
  <input name="runId" type="hidden" value={runId}>
</form>

<ConfirmDialog
  confirmLabel="Cancel {restore ? 'restore' : 'backup'}"
  description={restore
    ? "It stops within a few seconds. Files already unpacked stay, so the volume is left half-restored until you restore again. Services stopped for it are started again."
    : "It stops within a few seconds and nothing is kept in the bucket. Services stopped for it are started again."}
  onConfirm={() => form?.requestSubmit()}
  title="Cancel this {restore ? 'restore' : 'backup'}?"
  bind:open={confirming}
/>
