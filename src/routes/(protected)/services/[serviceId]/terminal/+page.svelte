<script lang="ts">
	import "@xterm/xterm/css/xterm.css";
	import {
		AlertTriangle,
		Loader2,
		Terminal as TerminalIcon,
	} from "@lucide/svelte";
	import type { ITheme, Terminal } from "@xterm/xterm";
	import { onDestroy, onMount } from "svelte";
	import { resolve } from "$app/paths";
	import { title } from "$lib/store/title";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Terminal`));

	let sessionId = $state<string | null>(null);
	let connecting = $state(false);
	let errored = $state<string | null>(null);
	let termEl = $state<HTMLElement | undefined>();
	let term: Terminal | undefined;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let cancelled = false;
	let pendingInput = "";
	let sending = false;
	const cleanups: (() => void)[] = [];

	const running = $derived(
		Boolean(svc.containerId || svc.swarmServiceId) &&
			svc.currentStatus === "running",
	);

	const sessionRoutes = {
		close: "/(protected)/services/[serviceId]/terminal/[sessionId]/close",
		input: "/(protected)/services/[serviceId]/terminal/[sessionId]/input",
		resize: "/(protected)/services/[serviceId]/terminal/[sessionId]/resize",
		stream: "/(protected)/services/[serviceId]/terminal/[sessionId]/stream",
	} as const;

	function sessionUrl(action: keyof typeof sessionRoutes) {
		return resolve(sessionRoutes[action], {
			serviceId: svc.id,
			sessionId: sessionId ?? "",
		});
	}

	function toRgb(color: string): string {
		const ctx = document.createElement("canvas").getContext("2d");
		if (!ctx) {
			return color;
		}
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		return `rgba(${r}, ${g}, ${b}, ${(a ?? 255) / 255})`;
	}

	function readTheme(): ITheme {
		const css = getComputedStyle(document.documentElement);
		const token = (name: string) => toRgb(css.getPropertyValue(name).trim());
		return {
			background: token("--color-bg"),
			cursor: token("--color-accent"),
			cursorAccent: token("--color-bg"),
			foreground: token("--color-text"),
			selectionBackground: token("--color-accent-glow"),
		};
	}

	function flushInput() {
		if (sending || !pendingInput || !sessionId) {
			return;
		}
		const chunk = pendingInput;
		pendingInput = "";
		sending = true;
		fetch(sessionUrl("input"), { body: chunk, method: "POST" })
			.then((res) => {
				if (!res.ok) {
					errored = "Session ended.";
				}
			})
			.catch(() => {
				errored = "Connection lost.";
			})
			.finally(() => {
				sending = false;
				flushInput();
			});
	}

	function sendResize(cols: number, rows: number) {
		if (!sessionId) {
			return;
		}
		fetch(sessionUrl("resize"), {
			body: JSON.stringify({ cols, rows }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}).catch(() => {
			errored = "Connection lost.";
		});
	}

	async function setupTerminal(el: HTMLElement): Promise<Terminal> {
		const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
			import("@xterm/xterm"),
			import("@xterm/addon-fit"),
		]);
		const css = getComputedStyle(document.documentElement);
		const terminal = new XTerm({
			cursorBlink: true,
			fontFamily: css.getPropertyValue("--font-mono").trim() || "monospace",
			fontSize: 12,
			theme: readTheme(),
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(el);
		fit.fit();

		const inputSub = terminal.onData((chunk) => {
			pendingInput += chunk;
			flushInput();
		});
		const resizeSub = terminal.onResize(({ cols, rows }) =>
			sendResize(cols, rows),
		);
		const resizeObserver = new ResizeObserver(() => fit.fit());
		resizeObserver.observe(el);
		const themeObserver = new MutationObserver(() => {
			terminal.options.theme = readTheme();
		});
		themeObserver.observe(document.documentElement, {
			attributeFilter: ["class", "style"],
		});
		cleanups.push(
			() => inputSub.dispose(),
			() => resizeSub.dispose(),
			() => resizeObserver.disconnect(),
			() => themeObserver.disconnect(),
			() => terminal.dispose(),
		);
		return terminal;
	}

	async function connect(el: HTMLElement) {
		connecting = true;
		errored = null;

		try {
			term = await setupTerminal(el);
			if (cancelled) {
				return;
			}
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
			const opened: { sessionId?: string } = await res.json();
			if (!opened.sessionId) {
				errored = "Couldn't open a session.";
				return;
			}
			sessionId = opened.sessionId;
			connecting = false;

			const streamRes = await fetch(sessionUrl("stream"));
			if (!(streamRes.ok && streamRes.body)) {
				errored = "Couldn't connect to the session output.";
				return;
			}
			sendResize(term.cols, term.rows);
			term.focus();
			flushInput();

			reader = streamRes.body.getReader();
			while (!cancelled) {
				// oxlint-disable-next-line no-await-in-loop -- stream reads are inherently sequential
				const { done, value } = await reader.read();
				if (done) {
					errored ??= "Session ended.";
					break;
				}
				term.write(value);
			}
		} catch {
			if (!cancelled) {
				errored = "Connection lost.";
			}
		} finally {
			connecting = false;
		}
	}

	onMount(() => {
		if (termEl) {
			void connect(termEl);
		}
	});

	onDestroy(() => {
		cancelled = true;
		reader?.cancel().catch(() => undefined);
		for (const cleanup of cleanups) {
			cleanup();
		}
		if (sessionId) {
			fetch(sessionUrl("close"), { method: "POST" }).catch(() => undefined);
		}
	});
</script>

<section class="rounded-md panel">
  <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
    <div class="flex items-center gap-2">
      <TerminalIcon class="size-4 text-text-muted" />
      <h2 class="eyebrow">Terminal</h2>
      {#if sessionId && !errored}
        <span class="flex items-center gap-1 text-xs text-green-600">
          <span class="size-1.5 rounded-full bg-green-500"></span>
          connected
        </span>
      {/if}
    </div>
  </div>

  <div class="flex items-start gap-2.5 border-b border-border bg-amber-50 px-5 py-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
    <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
    <p>
      Runs a shell (<code>bash</code> if the image has it, <code>sh</code>
      otherwise) inside this service's live container, with whatever access that
      shell has : anything you run here can modify or break the running service.
    </p>
  </div>

  {#if running}
    {#if connecting}
      <p class="flex items-center gap-2 border-b border-border px-5 py-2 text-xs text-text-muted">
        <Loader2 class="size-3.5 animate-spin" />
        Opening session…
      </p>
    {:else if errored}
      <p class="border-b border-border px-5 py-2 text-xs text-destructive">
        {errored}
      </p>
    {/if}
    <div class="h-[32rem] bg-bg p-3">
      <div
        class="size-full"
        bind:this={termEl}
      ></div>
    </div>
  {:else}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <p class="text-sm font-medium text-text-muted">
        This service isn't running.
      </p>
      <p class="mt-1 text-xs text-text-subtle">
        Deploy or start it first : a terminal needs a live container.
      </p>
    </div>
  {/if}
</section>
