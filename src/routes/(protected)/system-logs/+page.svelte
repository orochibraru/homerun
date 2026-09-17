<script lang="ts">
	import { Boxes, Loader2, RotateCw, Wrench } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import LiveLogViewer from "$lib/components/live-log-viewer.svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { getInfraStatus } from "$lib/remote/docker-infra.remote";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	onMount(() => title.set("System Logs"));

	const status = getInfraStatus();
	const infra = $derived(status.current?.infra ?? []);
	const traefikId = $derived(status.current?.traefik?.id ?? null);

	let restarting = $state(false);
	let updating = $state(false);

	let confirmKind = $state<"restart" | "update" | null>(null);
	let confirmDialogOpen = $state(false);
	let restartForm: HTMLFormElement | null = null;
	let updateForm: HTMLFormElement | null = null;

	function requestRestart(e: MouseEvent) {
		restartForm = (e.currentTarget as HTMLElement).closest("form");
		confirmKind = "restart";
		confirmDialogOpen = true;
	}

	function requestUpdate(e: MouseEvent) {
		updateForm = (e.currentTarget as HTMLElement).closest("form");
		confirmKind = "update";
		confirmDialogOpen = true;
	}

	function confirmPending() {
		if (confirmKind === "restart") {
			restarting = true;
			restartForm?.requestSubmit();
		} else if (confirmKind === "update") {
			updating = true;
			updateForm?.requestSubmit();
		}
	}

	let selectedInfraId = $state<string | null>(null);
</script>

<div class="p-5 md:p-6">
  <div class="mb-6">
    <h1 class="text-text text-lg font-semibold tracking-tight">System Logs</h1>
    <p class="text-text-muted mt-1 text-sm">
      Logs from core infrastructure this app depends on.
    </p>
  </div>

  {#if !status.ready}
    <Skeleton class="h-40 w-full" />
  {:else if infra.length === 0}
    <EmptyState
      icon={Boxes}
      subtitle="Homerun isn't running as a Docker Compose service here, so there's no stack to show."
      title="No stack containers found"
    />
  {:else}
    <section class="panel rounded-xl">
      <div class="panel-head">
        <h2 class="eyebrow flex items-center gap-1.5">
          <Boxes class="size-3" />
          This instance's stack
        </h2>
        <span class="text-text-subtle text-[0.6875rem]">
          Everything your compose file starts, Homerun included
        </span>
      </div>
      <div class="divide-border divide-y">
        {#each infra as container (container.id)}
          <button
            class="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors {selectedInfraId ===
            container.id
              ? 'bg-accent-light'
              : ''}"
            onclick={() => {
              selectedInfraId =
                selectedInfraId === container.id ? null : container.id;
            }}
            type="button"
          >
            <span
              class="size-1.5 shrink-0 rounded-full {container.state === 'running'
              ? 'bg-emerald-500'
              : 'bg-zinc-400'}"
            ></span>
            <span class="min-w-0 flex-1">
              <span class="text-text block truncate text-sm font-medium">
                {container.service || container.name}
              </span>
              <span class="text-text-subtle block truncate text-xs">
                {container.image}
              </span>
            </span>
            <span class="text-text-subtle shrink-0 text-[0.6875rem]">
              {container.state}
            </span>
          </button>
          {#if selectedInfraId === container.id}
            <div class="space-y-2 p-3">
              {#if container.id === traefikId}
                <div class="flex items-center justify-end gap-2">
                  <form
                    action="?/restartTraefik"
                    method="POST"
                    use:enhance={enhanceToast({
                      error: "Couldn't restart Traefik.",
                      loading: "Restarting Traefik",
                      onSettled: () => {
                        restarting = false;
                      },
                      onStart: () => {
                        restarting = true;
                      },
                      success: "Traefik restarted.",
                    })}
                  >
                    <Button
                      disabled={restarting || updating}
                      onclick={requestRestart}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {#if restarting}
                        <Loader2 class="size-3.5 animate-spin" />
                      {:else}
                        <RotateCw class="size-3.5" />
                      {/if}
                      Restart
                    </Button>
                  </form>
                  <form
                    action="?/updateTraefik"
                    method="POST"
                    use:enhance={enhanceToast({
                      error: "Couldn't update Traefik.",
                      loading: "Updating Traefik",
                      onSettled: () => {
                        updating = false;
                      },
                      onStart: () => {
                        updating = true;
                      },
                      success: (data) =>
                        (data as { message?: string } | undefined)?.message ??
                        "Traefik updated.",
                    })}
                  >
                    <Button
                      disabled={restarting || updating}
                      onclick={requestUpdate}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {#if updating}
                        <Loader2 class="size-3.5 animate-spin" />
                      {:else}
                        <Wrench class="size-3.5" />
                      {/if}
                      Update
                    </Button>
                  </form>
                </div>
              {/if}
              <LiveLogViewer
                heightClass="h-96"
                logsUrl="{resolve('/system-logs')}/containers/{container.id}/logs"
                serviceId={container.id}
                workloadId={container.id}
              />
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmDialogOpen}
  onConfirm={confirmPending}
  title={confirmKind === "restart" ? "Restart Traefik?" : "Update Traefik?"}
  description={confirmKind === "restart"
  ? "Every deployed service routed through it will be briefly unreachable while it comes back up."
  : "If a newer image is available, this stops and recreates the container in place (same config, new image) : brief downtime for every routed service, and no automatic rollback if the new container fails to start."}
  confirmLabel={confirmKind === "restart" ? "Restart" : "Update"}
/>
