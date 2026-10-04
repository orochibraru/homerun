<script lang="ts">
	import { ShieldCheck } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	interface Props {
		svc: { id: string; imageScanEnabled: boolean };
	}

	const { svc }: Props = $props();

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
  <PanelHeader icon={ShieldCheck} title="Image scanning">
    {#snippet description()}
      Scans the image for known vulnerabilities on every deploy, through
      Homerun's pull mirror. Results are on the
      <a
        class="text-accent underline"
        href={resolve("/(protected)/services/[serviceId]/security", {
          serviceId: svc.id,
        })}
      >Security</a>
      tab.
    {/snippet}
    {#snippet trailing()}
      <SaveButton form="image-scan" pending={submitting} />
    {/snippet}
  </PanelHeader>

  <form
    id="image-scan"
    action="?/updateImageScan"
    class="space-y-3 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save image scanning.",
      loading: "Saving image scanning",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Saved.",
    })}
  >
    <CheckBox
      checked={svc.imageScanEnabled}
      helperText="Pull through the mirror and scan before this service's workload starts. Turning it off pulls straight from the registry."
      id="imageScanEnabled"
      label="Scan this service's image"
      name="imageScanEnabled"
    />
  </form>
</section>
