<script lang="ts">
	import { Play, RotateCw, Square, Trash2 } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { enhance } from "$app/forms";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";

	interface Props {
		ondelete: (e: MouseEvent) => void;
		pending: boolean;
		service: { containerId: string | null; desiredState: string; id: string };
		submit: (action: "delete" | "restart" | "start" | "stop") => SubmitFunction;
	}

	const { ondelete, pending, service: svc, submit }: Props = $props();
</script>

<div class="flex shrink-0 items-center gap-1.5">
  {#if svc.desiredState === "running"}
    <form
      action="?/stop"
      data-row-action="stop"
      data-service={svc.id}
      method="POST"
      use:enhance={submit("stop")}
    >
      <input name="serviceId" type="hidden" value={svc.id}>
      <Button
        disabled={pending}
        size="icon-sm"
        title="Stop"
        type="submit"
        variant="ghost"
      >
        {#if pending}
          <Spinner />
        {:else}
          <Square class="size-4" />
        {/if}
      </Button>
    </form>
  {:else}
    <form
      action="?/start"
      data-row-action="start"
      data-service={svc.id}
      method="POST"
      use:enhance={submit("start")}
    >
      <input name="serviceId" type="hidden" value={svc.id}>
      <Button
        disabled={pending || !svc.containerId}
        size="icon-sm"
        title={svc.containerId
        ? "Start"
        : "Deploy first from the service page"}
        type="submit"
        variant="ghost"
      >
        {#if pending}
          <Spinner />
        {:else}
          <Play class="size-4" />
        {/if}
      </Button>
    </form>
  {/if}

  <form
    action="?/restart"
    data-row-action="restart"
    data-service={svc.id}
    method="POST"
    use:enhance={submit("restart")}
  >
    <input name="serviceId" type="hidden" value={svc.id}>
    <Button
      disabled={pending || !svc.containerId}
      size="icon-sm"
      title="Restart"
      type="submit"
      variant="ghost"
    >
      <RotateCw class="size-4" />
    </Button>
  </form>

  <form
    action="?/delete"
    data-row-action="delete"
    data-service={svc.id}
    method="POST"
    use:enhance={submit("delete")}
  >
    <input name="serviceId" type="hidden" value={svc.id}>
    <Button
      class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
      disabled={pending}
      onclick={ondelete}
      size="icon-sm"
      title="Delete"
      type="button"
      variant="ghost"
    >
      <Trash2 class="size-4" />
    </Button>
  </form>
</div>
