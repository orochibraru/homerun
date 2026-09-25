<script lang="ts">
	import { stripAnsi } from "$lib/ansi";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import CopyButton from "$lib/components/copy-button.svelte";

	const {
		errorMessage,
		log,
		logName = "build log",
	}: {
		errorMessage: string | null;
		log: string;
		/** What the log is, for the copy button: "build log", "backup log". */
		logName?: string;
	} = $props();

	const lines = $derived(log.split("\n").filter(Boolean));
	const copyValue = $derived(
		stripAnsi(errorMessage ? `${errorMessage}\n\n${log}` : log),
	);
</script>

<div class="mx-5 mb-3 overflow-hidden rounded-md">
  <div class="flex items-center justify-end bg-zinc-900 px-2 py-1">
    <CopyButton
      class="text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      label={errorMessage ? `the error and ${logName}` : `the ${logName}`}
      text={errorMessage ? "Copy error and log" : "Copy log"}
      value={copyValue}
    />
  </div>
  <div class="max-h-64 overflow-y-auto log-output">
    {#each lines as line, i (i)}
      <AnsiLine {line} />
    {/each}
  </div>
</div>
