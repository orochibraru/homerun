<script lang="ts">
	import { Globe, HardDrive } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { formatBytes } from "#lib/formatting.js";
	import { queuedJobToast } from "#lib/job-toast.js";
	import { enhance } from "$app/forms";

	const { data } = $props();

	let publicHost = $state("");
	$effect(() => {
		publicHost = data.status.publicHost ?? "";
	});
	let enabled = $state(false);
	$effect(() => {
		enabled = data.status.enabled;
	});
	let toggling = $state(false);
	let publishing = $state(false);
</script>

<section class="panel mb-6 rounded-md">
  <PanelHeader
    description="A single Garage node Homerun runs next to the registry, with its data in Docker volumes that survive turning it off."
    icon={HardDrive}
    title="Built-in object store"
  >
    {#snippet trailing()}
      <SaveButton
        disabled={enabled === data.status.enabled}
        form="garage-enabled"
        pending={toggling}
      />
    {/snippet}
  </PanelHeader>
  <div class="space-y-4 px-5 py-4">
    <dl class="grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt class="text-text-muted text-xs">Container</dt>
        <dd class="text-text mt-0.5">
          {data.status.running ? "Running" : "Not running"}
        </dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Stored</dt>
        <dd class="text-text mt-0.5">
          {data.status.usageBytes === null
            ? "Unknown"
            : formatBytes(data.status.usageBytes)}
        </dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Address on Homerun's network</dt>
        <dd class="text-text mt-0.5 font-mono text-xs">http://homerun-garage:3900</dd>
      </div>
    </dl>
    <form
      id="garage-enabled"
      action="?/setEnabled"
      method="POST"
      use:enhance={queuedJobToast({
        error: "Couldn't change the built-in store.",
        loading: "Queueing the change",
        onSettled: () => {
          toggling = false;
        },
        onStart: () => {
          toggling = true;
        },
        success: "The built-in store is being reconfigured in the background.",
      })}
    >
      <CheckBox
        helperText="Turning it off stops the container. Buckets and objects stay in their volumes for when it's back on."
        id="garageEnabled"
        label="Run the built-in object store"
        name="enabled"
        bind:checked={enabled}
      />
    </form>
  </div>
</section>

<section class="panel rounded-md">
  <PanelHeader
    description="Routes the store's S3 API through Traefik at a hostname of your own, so machines outside this server can use it. Leave it empty to keep it internal."
    icon={Globe}
    title="Publish it"
  >
    {#snippet trailing()}
      <SaveButton
        disabled={!data.status.enabled}
        form="garage-public-host"
        pending={publishing}
      />
    {/snippet}
  </PanelHeader>
  <form
    id="garage-public-host"
    class="px-5 py-4"
    action="?/setPublicHost"
    method="POST"
    use:enhance={queuedJobToast({
      error: "Couldn't publish the store.",
      loading: "Queueing the change",
      onSettled: () => {
        publishing = false;
      },
      onStart: () => {
        publishing = true;
      },
      success: "The store's route is being reconfigured in the background.",
    })}
  >
    <label class={labelClass} for="garagePublicHost">Hostname</label>
    <input
      id="garagePublicHost"
      class="{inputClass} max-w-sm"
      autocomplete="off"
      disabled={!data.status.enabled}
      name="publicHost"
      placeholder={data.suggestedHost || "s3.example.com"}
      bind:value={publicHost}
    />
  </form>
</section>
