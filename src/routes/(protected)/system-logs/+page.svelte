<script lang="ts">
	import { Info, Loader2, RefreshCw, Terminal } from "@lucide/svelte";
	import { onDestroy, onMount, tick } from "svelte";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("System Logs"));

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
		connect();
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-text">System Logs</h1>
    <p class="mt-1 text-sm text-text-muted">
      Logs from core infrastructure this app depends on.
    </p>
  </div>

  <div
    class="mb-6 flex items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-text-muted"
  >
    <Info class="mt-0.5 size-3.5 shrink-0" />
    <p>
      Local Run's own server isn't containerized — it runs directly on the host,
      so its logs are whatever process manager or terminal you started
      <code class="rounded bg-surface px-1 py-0.5">bun run start</code>
      from is already capturing (no in-app viewer for it here).
    </p>
  </div>

  <section class="rounded-2xl border border-border bg-surface">
    <div
      class="flex items-center justify-between gap-3 border-b border-border px-5 py-4"
    >
      <div class="flex items-center gap-2">
        <Terminal class="size-4 text-text-muted" />
        <h2 class="text-sm font-semibold text-text">Traefik</h2>
        {#if connected}
          <span class="flex items-center gap-1 text-xs text-green-600">
            <span class="size-1.5 rounded-full bg-green-500"></span>
            live
          </span>
        {/if}
      </div>
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

    <div
      class="h-[28rem] overflow-y-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
      bind:this={logEl}
    >
      {#if !data.traefik}
        <p class="text-zinc-500">
          Traefik container not found — is it running (`docker compose up -d`)?
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
          <div class="break-all whitespace-pre-wrap">{line}</div>
        {/each}
      {/if}
    </div>
  </section>
</div>
