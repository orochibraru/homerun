<script lang="ts">
	import { TerminalSquare } from "@lucide/svelte";
	import { onMount } from "svelte";
	import Alert from "#lib/components/alert.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import RuntimeFields from "#lib/components/runtime-fields.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { joinShellWords } from "#lib/shell-words.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

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
			runAsUser: svc.runAsUser ?? "",
		},
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="How the container starts and what it can reach on the host. Changes take effect on the next deploy."
    icon={TerminalSquare}
    title="Runtime"
  >
    {#snippet trailing()}
      <SaveButton form="runtime-settings" pending={submitting} />
    {/snippet}
  </PanelHeader>

  <form
    id="runtime-settings"
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
  </form>
</section>
