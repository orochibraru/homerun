<script lang="ts">
	import { Loader2, RefreshCw, Terminal } from "@lucide/svelte";
	import { onDestroy, onMount, tick } from "svelte";
	import { resolve } from "$app/paths";
	import AnsiLine from "$lib/components/ansi-line.svelte";

	// Extracted from the Logs tab (services/[serviceId]/logs/+page.svelte) so
	// the same live-streamed, ANSI-colored log panel can also be embedded
	// directly in the Overview tab : same "shared chrome" precedent as
	// form-styles.ts, just for a whole panel instead of class strings.
	const {
		serviceId,
		containerId,
		heightClass = "h-[28rem]",
	}: {
		serviceId: string;
		containerId: string | null;
		heightClass?: string;
	} = $props();

	let lines = $state<string[]>([]);
	let connected = $state(false);
	let errored = $state(false);
	let logEl = $state<HTMLElement | undefined>();
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let cancelled = false;

	async function connect() {
		if (!containerId) {
			return;
		}
		lines = [];
		connected = false;
		errored = false;

		try {
			const res = await fetch(
				resolve("/(protected)/services/[serviceId]/logs", { serviceId }),
			);
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
</script>

<section class="border-border bg-surface rounded-2xl border">
  <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
    <div class="flex items-center gap-2">
      <Terminal class="text-text-muted size-4" />
      <h2 class="text-text text-sm font-semibold">Logs</h2>
      {#if connected}
        <span class="flex items-center gap-1 text-xs text-green-600">
          <span class="size-1.5 rounded-full bg-green-500"></span>
          live
        </span>
      {/if}
    </div>
    <button
      class="text-text-muted hover:bg-surface-2 hover:text-text flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!containerId}
      onclick={reconnect}
      type="button"
    >
      <RefreshCw class="size-3.5" />
      Reconnect
    </button>
  </div>

  <div
    class="{heightClass} overflow-y-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
    bind:this={logEl}
  >
    {#if !containerId}
      <p class="text-zinc-500">This service hasn't been deployed yet.</p>
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
