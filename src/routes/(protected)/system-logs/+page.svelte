<script lang="ts">
	import {
		Info,
		Loader2,
		RefreshCw,
		RotateCw,
		Terminal,
		Wrench,
	} from "@lucide/svelte";
	import { onDestroy, onMount, tick } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	onMount(() => title.set("System Logs"));

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
		if (!data.traefik) {
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

	onMount(connect);

	onDestroy(() => {
		cancelled = true;
		reader?.cancel();
	});

	function reconnect() {
		cancelled = false;
		void connect();
	}

	$effect(() => {
		if (!form) {
			return;
		}
		if (form.action === "restartTraefik") {
			restarting = false;
			if (form.success) {
				toast.success("Traefik restarted.");
			} else {
				toast.error(form.error ?? "Couldn't restart Traefik.");
			}
		} else if (form.action === "updateTraefik") {
			updating = false;
			if (form.success) {
				toast[form.updated ? "success" : "info"](
					form.message ?? "Traefik updated.",
				);
			} else {
				toast.error(form.error ?? "Couldn't update Traefik.");
			}
		}
	});
</script>

<div class="p-6 md:p-8">
  <div class="mb-6">
    <h1 class="text-text text-2xl font-bold">System Logs</h1>
    <p class="text-text-muted mt-1 text-sm">
      Logs from core infrastructure this app depends on.
    </p>
  </div>

  <div class="border-border bg-surface-2 text-text-muted mb-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs">
    <Info class="mt-0.5 size-3.5 shrink-0" />
    <p>
      Local Run's own server isn't containerized : it runs directly on the host,
      so its logs are whatever process manager or terminal you started
      <code class="bg-surface rounded px-1 py-0.5">bun run start</code>
      from is already capturing (no in-app viewer for it here).
    </p>
  </div>

  <section class="border-border bg-surface rounded-2xl border">
    <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
      <div class="flex items-center gap-2">
        <Terminal class="text-text-muted size-4" />
        <h2 class="text-text text-sm font-semibold">Traefik</h2>
        {#if data.traefik}
          <code
            class="bg-surface-2 text-text-muted rounded px-1.5 py-0.5 text-[11px]"
          >
            {data.traefik.image}
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
        {#if data.traefik && data.user.role === "admin"}
          <form action="?/restartTraefik" method="POST" use:enhance>
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
          <form action="?/updateTraefik" method="POST" use:enhance>
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
          disabled={!data.traefik}
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
      class="h-112 overflow-y-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
      bind:this={logEl}
    >
      {#if !data.traefik}
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
