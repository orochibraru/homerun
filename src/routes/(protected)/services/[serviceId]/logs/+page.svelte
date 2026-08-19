<script lang="ts">
  import { Loader2, RefreshCw, Terminal } from "@lucide/svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import { resolve } from "$app/paths";
  import { title } from "$lib/store/title";

  const { data } = $props();
  const svc = $derived(data.service);

  onMount(() => title.set(`${svc.name} · Logs`));

  let lines = $state<string[]>([]);
  let connected = $state(false);
  let errored = $state(false);
  let logEl = $state<HTMLElement | undefined>();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false;

  async function connect() {
    if (!svc.containerId) {
      return;
    }
    lines = [];
    connected = false;
    errored = false;

    try {
      const res = await fetch(
        resolve("/services/[serviceId]/logs", { serviceId: svc.id })
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
        // biome-ignore lint/performance/noAwaitInLoops: streaming reads are inherently sequential — each chunk depends on the previous read() resolving.
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

<section class="rounded-2xl border border-border bg-surface">
  <div
    class="flex items-center justify-between gap-3 border-b border-border px-5 py-4"
  >
    <div class="flex items-center gap-2">
      <Terminal class="size-4 text-text-muted" />
      <h2 class="text-sm font-semibold text-text">Logs</h2>
      {#if connected}
        <span class="flex items-center gap-1 text-xs text-green-600">
          <span class="size-1.5 rounded-full bg-green-500"></span>
          live
        </span>
      {/if}
    </div>
    <button
      class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted transition-all hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!svc.containerId}
      onclick={reconnect}
      type="button"
    >
      <RefreshCw class="size-3.5" />
      Reconnect
    </button>
  </div>

  <div
    class="h-[28rem] overflow-y-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
    bind:this={logEl}
  >
    {#if !svc.containerId}
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
        <div class="break-all whitespace-pre-wrap">{line}</div>
      {/each}
    {/if}
  </div>
</section>
