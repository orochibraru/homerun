<script lang="ts">
	import {
		AlertTriangle,
		Loader2,
		Terminal as TerminalIcon,
	} from "@lucide/svelte";
	import { onDestroy, onMount, tick } from "svelte";
	import { toast } from "svelte-sonner";
	import { resolve } from "$app/paths";
	import { title } from "$lib/store/title";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Terminal`));

	let sessionId = $state<string | null>(null);
	let lines = $state<string[]>([]);
	let connecting = $state(false);
	let errored = $state<string | null>(null);
	let command = $state("");
	let termEl = $state<HTMLElement | undefined>();
	let inputEl = $state<HTMLInputElement | undefined>();
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let cancelled = false;

	// Strips ANSI escape/color codes for readable plain-text rendering : no
	// terminal-emulator dependency, this is a REPL-style view, not a full
	// xterm.js pty. Cursor-movement/clear-screen sequences aren't honored,
	// just stripped, so full-screen TUIs (vim, top) won't render usefully.
	const ANSI_RE = new RegExp(
		`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`,
		"g",
	);
	function stripAnsi(text: string): string {
		return text.replace(ANSI_RE, "");
	}

	async function connect() {
		connecting = true;
		errored = null;
		lines = [];

		try {
			const res = await fetch(
				resolve("/(protected)/services/[serviceId]/terminal/open", {
					serviceId: svc.id,
				}),
				{ method: "POST" },
			);
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errored = body.error ?? "Couldn't open a session.";
				return;
			}
			const { sessionId: openedSessionId } = await res.json();
			sessionId = openedSessionId;
			connecting = false;

			if (!sessionId) {
				toast.error("Invalid terminal session");
				throw new Error("No session ID found!");
			}

			const streamRes = await fetch(
				resolve(
					"/(protected)/services/[serviceId]/terminal/[sessionId]/stream",
					{
						serviceId: svc.id,
						sessionId,
					},
				),
			);
			if (!(streamRes.ok && streamRes.body)) {
				errored = "Couldn't connect to the session output.";
				return;
			}

			// Unlike the plain log viewer, a shell prompt often has no trailing
			// newline while it waits for input : so the in-progress last line
			// has to render too, not just completed ones. `lines`'s final
			// element is always that in-progress line, replaced (not appended
			// to) on every chunk until a "\n" promotes it to a completed line.
			const decoder = new TextDecoder();
			reader = streamRes.body.getReader();
			let pending = "";
			lines = [""];

			while (!cancelled) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				pending += stripAnsi(decoder.decode(value, { stream: true }));
				const parts = pending.split("\n");
				pending = parts.pop() ?? "";
				lines = [...lines.slice(0, -1), ...parts, pending];
				await tick();
				termEl?.scrollTo({ top: termEl.scrollHeight });
			}
		} catch {
			if (!cancelled) {
				errored = "Connection lost.";
			}
		} finally {
			connecting = false;
		}
	}

	onMount(connect);

	onDestroy(() => {
		cancelled = true;
		reader?.cancel();
		if (sessionId) {
			fetch(
				resolve(
					"/(protected)/services/[serviceId]/terminal/[sessionId]/close",
					{
						serviceId: svc.id,
						sessionId,
					},
				),
				{ method: "POST" },
			).catch(() => {
				// Best-effort : the idle reaper will clean it up regardless.
			});
		}
	});

	async function sendCommand(e: SubmitEvent) {
		e.preventDefault();
		if (!sessionId) {
			return;
		}
		const toSend = `${command}\n`;
		command = "";
		await fetch(
			resolve("/(protected)/services/[serviceId]/terminal/[sessionId]/input", {
				serviceId: svc.id,
				sessionId,
			}),
			{
				body: JSON.stringify({ data: toSend }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			},
		);
		inputEl?.focus();
	}
</script>

<section class="rounded-2xl border border-border bg-surface">
  <div
    class="flex items-center justify-between gap-3 border-b border-border px-5 py-4"
  >
    <div class="flex items-center gap-2">
      <TerminalIcon class="size-4 text-text-muted" />
      <h2 class="text-sm font-semibold text-text">Terminal</h2>
      {#if sessionId && !errored}
        <span class="flex items-center gap-1 text-xs text-green-600">
          <span class="size-1.5 rounded-full bg-green-500"></span>
          connected
        </span>
      {/if}
    </div>
  </div>

  <div
    class="flex items-start gap-2.5 border-b border-border bg-amber-50 px-5 py-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300"
  >
    <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
    <p>
      Runs <code>/bin/sh</code> inside this service's live container, with
      whatever access that shell has : anything you run here can modify or break
      the running service. Plain-text output only (ANSI codes are stripped), so
      full-screen tools like <code>vim</code> or
      <code>top</code>
      won't render usefully.
    </p>
  </div>

  {#if !svc.containerId || svc.currentStatus !== "running"}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <p class="text-sm font-medium text-text-muted">
        This service isn't running.
      </p>
      <p class="mt-1 text-xs text-text-subtle">
        Deploy or start it first : a terminal needs a live container.
      </p>
    </div>
  {:else}
    <div
      class="h-[24rem] overflow-y-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
      bind:this={termEl}
    >
      {#if connecting}
        <p class="flex items-center gap-2 text-zinc-500">
          <Loader2 class="size-3.5 animate-spin" />
          Opening session…
        </p>
      {:else if errored}
        <p class="text-red-400">{errored}</p>
      {:else}
        {#each lines as line, i (i)}
          <div class="break-all whitespace-pre-wrap">{line}</div>
        {/each}
      {/if}
    </div>

    <form
      class="flex items-center gap-2 border-t border-border p-3"
      onsubmit={sendCommand}
    >
      <span class="font-mono text-xs text-text-subtle">$</span>
      <input
        class="flex-1 bg-transparent font-mono text-sm text-text placeholder:text-text-subtle focus:outline-none"
        disabled={!sessionId || !!errored}
        placeholder="type a command, press enter"
        type="text"
        bind:this={inputEl}
        bind:value={command}
      />
    </form>
  {/if}
</section>
