<script lang="ts">
	import "@xterm/xterm/css/xterm.css";
	import { Loader2 } from "@lucide/svelte";
	import type { ITheme, Terminal } from "@xterm/xterm";
	import { onDestroy, onMount } from "svelte";

	type SessionAction = "close" | "input" | "resize" | "stream";

	interface Props {
		/** Tailwind classes sizing the terminal's box. */
		class?: string;
		/** Where a POST opens a session, answering `{ sessionId }` or `{ error }`. It gets `{ cols, rows }`. */
		openUrl: string;
		/** A session's route for one action. */
		sessionUrl: (action: SessionAction, sessionId: string) => string;
		/** Reports whether a session is open and healthy, for the caller's header. */
		onState?: (state: { connected: boolean }) => void;
	}

	const {
		class: className = "h-[32rem]",
		onState,
		openUrl,
		sessionUrl: routeFor,
	}: Props = $props();

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

	function sessionUrl(action: SessionAction) {
		return routeFor(action, sessionId ?? "");
	}

	$effect(() => {
		onState?.({ connected: Boolean(sessionId && !errored) });
	});

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
			const res = await fetch(openUrl, {
				body: JSON.stringify({ cols: term.cols, rows: term.rows }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});
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
		closeSession();
	});

	function closeSession() {
		if (sessionId) {
			navigator.sendBeacon(sessionUrl("close"));
			sessionId = null;
		}
	}
</script>

<svelte:window onpagehide={closeSession} />

{#if connecting}
  <p class="border-border text-text-muted flex items-center gap-2 border-b px-5 py-2 text-xs">
    <Loader2 class="size-3.5 animate-spin" />
    Opening session…
  </p>
{:else if errored}
  <p class="border-border text-destructive border-b px-5 py-2 text-xs">
    {errored}
  </p>
{/if}
<div class="bg-bg p-3 {className}">
  <div class="size-full" bind:this={termEl}></div>
</div>
