<script lang="ts">
	import type { SubmitFunction } from "@sveltejs/kit";
	import { tick } from "svelte";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import GroupDialog from "$lib/components/service-group-dialog.svelte";
	import LinkDialog from "$lib/components/service-link-dialog.svelte";
	import {
		SERVICE_ACTION_LABELS,
		type ServiceAction,
	} from "$lib/service-actions";
	import { enhanceToast } from "$lib/toast";

	interface MenuService {
		id: string;
		image: string;
		name: string;
		stackId: string | null;
	}

	interface Props {
		actionBase?: string;
		services: MenuService[];
		stacks: { id: string; name: string }[];
	}

	const { actionBase = "", services, stacks }: Props = $props();

	let target = $state<MenuService | null>(null);
	let op = $state<ServiceAction>("restart");
	let opForm = $state<HTMLFormElement | null>(null);
	let ungroupForm = $state<HTMLFormElement | null>(null);
	let deleteOpen = $state(false);
	let linkDialog = $state<ReturnType<typeof LinkDialog>>();
	let groupDialog = $state<ReturnType<typeof GroupDialog>>();

	function select(id: string): MenuService | null {
		target = services.find((svc) => svc.id === id) ?? null;
		return target;
	}

	const submitOp: SubmitFunction = (input) => {
		const label = SERVICE_ACTION_LABELS[op];
		const name = target?.name ?? "the service";
		return enhanceToast({
			error: `Couldn't ${label.verb} ${name}.`,
			loading: `${label.progressive} ${name}`,
			success: `${name} ${label.done}.`,
		})(input);
	};

	/** Runs a lifecycle action on a service, asking for a typed confirmation first when it's a delete. */
	export function run(action: ServiceAction, id: string): void {
		if (!select(id)) {
			return;
		}
		op = action;
		if (action === "delete") {
			deleteOpen = true;
			return;
		}
		void tick().then(() => opForm?.requestSubmit());
	}

	/** Opens the "Link to…" dialog for a service. */
	export function link(svc: { id: string }): void {
		if (select(svc.id)) {
			linkDialog?.show();
		}
	}

	/** Opens the group-into-stack dialog for a service, preselecting its current stack. */
	export function group(svc: { id: string }): void {
		if (select(svc.id)) {
			groupDialog?.show(target?.stackId ?? null);
		}
	}

	/** Takes a service out of its stack. */
	export function ungroup(svc: { id: string }): void {
		if (select(svc.id)) {
			void tick().then(() => ungroupForm?.requestSubmit());
		}
	}
</script>

<form
  action="{actionBase}?/{op}"
  class="hidden"
  method="POST"
  bind:this={opForm}
  use:enhance={submitOp}
>
  <input name="serviceId" type="hidden" value={target?.id ?? ""}>
</form>

<form
  action="{actionBase}?/group"
  class="hidden"
  method="POST"
  bind:this={ungroupForm}
  use:enhance={enhanceToast({
    error: "Couldn't ungroup the service.",
    loading: "Ungrouping",
    success: "Removed from its stack.",
  })}
>
  <input name="serviceId" type="hidden" value={target?.id ?? ""}>
  <input name="stackId" type="hidden" value="">
</form>

<ConfirmDialog
  confirmLabel="Delete"
  confirmPhrase={target?.name ?? ""}
  description={`Delete "${target?.name ?? ""}"? This removes its container and can't be undone.`}
  onConfirm={() => opForm?.requestSubmit()}
  title="Delete service"
  bind:open={deleteOpen}
/>

<LinkDialog
  bind:this={linkDialog}
  {actionBase}
  service={target}
  {services}
  {stacks}
/>

<GroupDialog bind:this={groupDialog} {actionBase} service={target} {stacks} />
