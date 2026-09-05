<script lang="ts">
	import { FileUp } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import ResponsiveDialog from "$lib/components/responsive-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { type ParsedEnvVar, parseDotEnv } from "$lib/env-parse";

	const { onImport }: { onImport: (rows: ParsedEnvVar[]) => void } = $props();

	let open = $state(false);
	let text = $state("");

	function apply() {
		const rows = parseDotEnv(text);
		if (rows.length === 0) {
			toast.error("No KEY=value lines found.");
			return;
		}
		onImport(rows);
		toast.success(
			`Imported ${rows.length} variable${rows.length === 1 ? "" : "s"}.`,
		);
		text = "";
		open = false;
	}
</script>

<Button class="mt-1 h-auto p-0" onclick={() => (open = true)} variant="link">
  <FileUp class="size-3.5" />
  Paste .env
</Button>

<ResponsiveDialog
  bind:open
  description="Paste the contents of a .env file, one KEY=value per line. Existing variables with the same key are overwritten."
  onsubmit={apply}
  size="sm"
  submitDisabled={text.trim() === ""}
  submitLabel="Import"
  title="Paste .env file"
>
  <textarea
    bind:value={text}
    class="h-48 w-full resize-none rounded-lg glass p-3 font-mono text-xs text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
    placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=secret"}
  ></textarea>
</ResponsiveDialog>
