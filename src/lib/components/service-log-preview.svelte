<script lang="ts">
	import { resolve } from "$app/paths";

	import { parseAnsiLine } from "#lib/ansi.js";

	interface Props {
		serviceId: string;
		workloadId: string | null;
	}

	const { serviceId, workloadId }: Props = $props();

	const SHOWN = 5;
	const STAMP = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\S*\s/;

	let lines = $state<string[]>([]);
	let connected = $state(false);
	let errored = $state(false);

	$effect(() => {
		if (!workloadId) {
			return;
		}
		const url = resolve("/(protected)/services/[serviceId]/logs", {
			serviceId,
		});
		const controller = new AbortController();
		lines = [];
		errored = false;

		void (async () => {
			try {
				const res = await fetch(url, { signal: controller.signal });
				if (!(res.ok && res.body)) {
					errored = true;
					return;
				}
				connected = true;
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				for (;;) {
					// oxlint-disable-next-line no-await-in-loop -- stream reads are inherently sequential
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					buffer += decoder.decode(value, { stream: true });
					const parts = buffer.split("\n");
					buffer = parts.pop() ?? "";
					if (parts.length > 0) {
						lines = [...lines, ...parts.filter(Boolean)].slice(-SHOWN);
					}
				}
			} catch {
				if (!controller.signal.aborted) {
					errored = true;
				}
			} finally {
				connected = false;
			}
		})();

		return () => controller.abort();
	});

	const rows = $derived(
		lines.map((line) => {
			const match = STAMP.exec(line);
			return {
				segments: parseAnsiLine(match ? line.slice(match[0].length) : line),
				time: match?.[1] ?? null,
			};
		}),
	);
</script>

<section
	class="panel flex min-w-0 flex-col rounded-[1.125rem] px-5 pt-4.5 pb-3.5"
>
	<div class="mb-3 flex items-center gap-2">
		<h2 class="text-text text-[1.0625rem] font-[650] tracking-tight">Logs</h2>
		{#if connected}
			<span
				class="size-1.75 rounded-full bg-emerald-500 ring-3 ring-emerald-500/20"
				title="Live"
			></span>
		{/if}
		<a
			class="text-text-subtle hover:text-text ml-auto text-[0.78rem] font-semibold"
			href={resolve("/(protected)/services/[serviceId]/observability/logs", {
				serviceId,
			})}
		>
			Open
		</a>
	</div>
	<div
		class="min-h-40 flex-1 overflow-hidden rounded-[0.875rem] bg-[oklch(0.17_0.006_290)] px-3.5 py-3 font-mono text-[0.72rem] leading-[1.85] text-[oklch(0.82_0.01_290)]"
	>
		{#if !workloadId}
			<p class="text-zinc-500">This service hasn't been deployed yet.</p>
		{:else if errored}
			<p class="text-red-400">Couldn't connect to the log stream.</p>
		{:else if rows.length === 0}
			<p class="text-zinc-500">Waiting for output…</p>
		{:else}
			{#each rows as row, i (i)}
				<div class="truncate">
					{#if row.time}
						<span class="opacity-45">{row.time}</span>
					{/if}
					{#each row.segments as segment, j (j)}
						<span class={segment.className}>{segment.text}</span>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
</section>
