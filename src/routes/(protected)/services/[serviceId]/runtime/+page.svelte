<script lang="ts">
	import { Check, TerminalSquare } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import Alert from "$lib/components/alert.svelte";
	import RuntimeFields from "$lib/components/runtime-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { joinShellWords } from "$lib/shell-words";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Runtime`));

	const values = $derived(
		(form?.values as Record<string, string> | undefined) ?? {
			capAdd: (svc.capAdd ?? []).join(", "),
			command: svc.command ? joinShellWords(svc.command) : "",
			devices: (svc.devices ?? []).join("\n"),
			entrypoint: svc.entrypoint ? joinShellWords(svc.entrypoint) : "",
			labels: Object.entries(svc.labels ?? {})
				.map(([key, value]) => `${key}=${value}`)
				.join("\n"),
			privileged: svc.privileged ? "on" : "",
		},
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
  <div class="border-border flex items-center gap-3 border-b px-5 py-4">
    <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
      <TerminalSquare class="size-4" />
    </div>
    <div>
      <h2 class="eyebrow">Runtime</h2>
      <p class="text-text-muted text-xs">
        How the container starts and what it can reach on the host. Changes
        take effect on the next deploy.
      </p>
    </div>
  </div>

  <form
    action="?/updateRuntime"
    class="space-y-5 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Saving runtime settings",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Saved.",
    })}
  >
    {#if form?.error}
      <Alert>{form.error}</Alert>
    {/if}

    <RuntimeFields
      {errors}
      isAdmin={data.isAdmin}
      swarm={data.orchestrationMode === "swarm"}
      {values}
    />

    <div class="flex justify-end">
      <Button disabled={submitting} type="submit">
        {#if submitting}
          <Spinner />
          Saving…
        {:else}
          <Check class="size-4" />
          Save
        {/if}
      </Button>
    </div>
  </form>
</section>
