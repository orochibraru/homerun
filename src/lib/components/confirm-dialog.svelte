<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = "Confirm",
		cancelLabel = "Cancel",
		destructive = true,
		onConfirm,
	}: {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		// Styles the confirm button red — off for confirmations that aren't
		// destructive (e.g. "restart Traefik").
		destructive?: boolean;
		onConfirm: () => void;
	} = $props();
</script>

<!--
  Shared replacement for the browser's own confirm() — every destructive
  action in this app (delete, remove, restart) used to gate its <form>
  submission behind a plain confirm() call; this renders as an actual
  themed dialog instead, consistent with the rest of the UI (and testable,
  unlike a native confirm() Playwright can't easily assert against).
  Consumers own their own trigger (a button that sets `open = true`) and
  their own submission (`onConfirm` — usually `formEl.requestSubmit()`).
-->
<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      {#if description}
        <Dialog.Description>{description}</Dialog.Description>
      {/if}
    </Dialog.Header>
    <Dialog.Footer>
      <Button
        onclick={() => {
          open = false;
        }}
        type="button"
        variant="outline"
      >
        {cancelLabel}
      </Button>
      <Button
        onclick={() => {
          open = false;
          onConfirm();
        }}
        type="button"
        variant={destructive ? "destructive" : "default"}
      >
        {confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
