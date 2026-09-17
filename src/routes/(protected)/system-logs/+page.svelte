<script lang="ts">
	import {
		Boxes,
		Info,
		Loader2,
		RefreshCw,
		RotateCw,
		Terminal,
		Wrench,
	} from "@lucide/svelte";
	import { onDestroy, onMount, tick } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import LiveLogViewer from "$lib/components/live-log-viewer.svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { getInfraStatus } from "$lib/remote/docker-infra.remote";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("System Logs"));

	const status = getInfraStatus();
	const infra = $derived(status.current?.infra ?? []);
	const traefik = $derived(status.current?.traefik ?? null);

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

	let lines = $state<string[]>([]);
	let connected = $state(false);
	let errored = $state(false);
	let logEl = $state<HTMLElement | undefined>();
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let cancelled = false;

	async function connect() {
		if (!traefik) {
			return;
		}
		lines = [];
		connected = false;
		errored = false;

		try {
			const res = await fetch(resolve("/system-logs/traefik"));
			if (!(res.ok && res.body)) {
				errored = true;
				return;
			}
			connected = true;

			const decoder = new TextDecoder();
			reader = res.body.getReader();
			let buffer = "";

			while (!cancelled) {
				// biome-ignore lint/performance/noAwaitInLoops: stream reads are inherently sequential
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n");
				buffer = parts.pop() ?? "";
				if (parts.length > 0) {
					lines.push(...parts);
					await tick();
					logEl?.scrollTo({ top: logEl.scrollHeight });
				}
			}
		} catch {
			if (!cancelled) {
				errored = true;
			}
		} finally {
			connected = false;
		}
	}

	$effect(() => {
		if (traefik && !connected && !errored) {
			void connect();
		}
	});

	onDestroy(() => {
		cancelled = true;
		reader?.cancel();
	});

	function reconnect() {
		cancelled = false;
		void connect();
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

  {#if infra.length > 0}
    <section class="panel mb-4 rounded-xl">
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
            <div class="p-3">
              <LiveLogViewer
                containerId={container.id}
                heightClass="h-64"
                logsUrl="{resolve('/system-logs')}/containers/{container.id}/logs"
                serviceId={container.id}
              />
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/if}

  <section class="panel rounded-md">
    <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
      <div class="flex items-center gap-2">
        <Terminal class="text-text-muted size-4" />
        <h2 class="eyebrow">Traefik</h2>
        {#if traefik}
          <code
            class="bg-surface-2 text-text-muted rounded px-1.5 py-0.5 text-[11px]"
          >
            {traefik.image}
          </code>
        {/if}
        {#if connected}
          <span class="flex items-center gap-1 text-xs text-green-600">
            <span class="size-1.5 rounded-full bg-green-500"></span>
            live
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#if traefik && data.user.role === "admin"}
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
        {/if}
        <Button
          disabled={!traefik}
          onclick={reconnect}
          size="sm"
          variant="ghost"
        >
          <RefreshCw class="size-3.5" />
          Reconnect
        </Button>
      </div>
    </div>

    <div
      class="h-112 overflow-y-auto log-output"
      bind:this={logEl}
    >
      {#if !status.ready}
        <Skeleton class="h-4 w-2/3" />
      {:else if !traefik}
        <p class="text-zinc-500">
          Traefik container not found : is it running (`docker compose up -d`)?
        </p>
      {:else if errored}
        <p class="text-red-400">
          Couldn't connect to the log stream. Try Reconnect.
        </p>
      {:else if lines.length === 0}
        <p class="flex items-center gap-2 text-zinc-500">
          <Loader2 class="size-3.5 animate-spin" />
          Waiting for output…
        </p>
      {:else}
        {#each lines as line, i (i)}
          <AnsiLine {line} />
        {/each}
      {/if}
    </div>
  </section>
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
