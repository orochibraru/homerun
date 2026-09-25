<script lang="ts">
	import { Play, RotateCw, Square, Trash2 } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import BulkActionBar from "$lib/components/bulk-action-bar.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import type { ListSelection } from "$lib/list-selection.svelte";
	import {
		plural,
		SERVICE_ACTION_LABELS,
		type ServiceAction,
	} from "$lib/service-actions";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		selection: ListSelection;
	}

	const { selection }: Props = $props();

	let bulkOp = $state<ServiceAction>("start");
	let bulkPending = $state(false);
	let bulkDeleteDialogOpen = $state(false);
	let bulkForm = $state<HTMLFormElement | null>(null);
	let bulkDeleteSubmitter = $state<HTMLButtonElement | null>(null);

	const bulkSubmit: SubmitFunction = (input) => {
		const label = SERVICE_ACTION_LABELS[bulkOp];
		const count = selection.count;
		return enhanceToast({
			error: `Couldn't ${label.verb} the selected ${plural(count)}.`,
			loading: `${label.progressive} ${count} ${plural(count)}`,
			onSettled: () => {
				bulkPending = false;
			},
			onStart: () => {
				bulkPending = true;
			},
			onSuccess: () => {
				selection.clear();
			},
			success: (result) => {
				const summary = result as
					| { failed?: number; succeeded?: number }
					| undefined;
				const ok = summary?.succeeded ?? count;
				const failed = summary?.failed ?? 0;
				const base = `${ok} ${plural(ok)} ${label.done}`;
				return failed > 0 ? `${base}, ${failed} failed.` : `${base}.`;
			},
		})(input);
	};
</script>

<BulkActionBar
  action="?/bulk"
  idField="serviceId"
  label={plural(selection.count)}
  pending={bulkPending}
  {selection}
  submit={bulkSubmit}
  bind:form={bulkForm}
>
  <button
    class="hidden"
    name="op"
    type="submit"
    value="delete"
    bind:this={bulkDeleteSubmitter}
    aria-hidden="true"
    tabindex="-1"
  ></button>

  <Button
    disabled={bulkPending}
    name="op"
    onclick={() => {
      bulkOp = "start";
    }}
    size="sm"
    type="submit"
    value="start"
    variant="outline"
  >
    <Play class="size-3.5" />
    Start
  </Button>
  <Button
    disabled={bulkPending}
    name="op"
    onclick={() => {
      bulkOp = "stop";
    }}
    size="sm"
    type="submit"
    value="stop"
    variant="outline"
  >
    <Square class="size-3.5" />
    Stop
  </Button>
  <Button
    disabled={bulkPending}
    name="op"
    onclick={() => {
      bulkOp = "restart";
    }}
    size="sm"
    type="submit"
    value="restart"
    variant="outline"
  >
    <RotateCw class="size-3.5" />
    Restart
  </Button>
  <Button
    disabled={bulkPending}
    onclick={() => {
      bulkOp = "delete";
      bulkDeleteDialogOpen = true;
    }}
    size="sm"
    type="button"
    variant="destructive"
  >
    <Trash2 class="size-3.5" />
    Delete
  </Button>
</BulkActionBar>

<ConfirmDialog
  bind:open={bulkDeleteDialogOpen}
  confirmLabel="Delete {selection.count} {plural(selection.count)}"
  confirmPhrase="delete {selection.count} {plural(selection.count)}"
  description={`Delete ${selection.count} selected ${plural(selection.count)}? Their containers are removed and this can't be undone.`}
  onConfirm={() => bulkForm?.requestSubmit(bulkDeleteSubmitter ?? undefined)}
  title="Delete selected services"
/>
