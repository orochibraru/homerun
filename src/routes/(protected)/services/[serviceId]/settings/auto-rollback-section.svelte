<script lang="ts">
	import { RotateCcw } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	interface Props {
		svc: { autoRollback: boolean; id: string };
	}

	const { svc }: Props = $props();

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
  <PanelHeader icon={RotateCcw} title="Auto-rollback">
    {#snippet description()}
      Every deploy is watched for 90 seconds (longer while a healthcheck is
      still starting). A revision that exits, restart-loops or fails its
      healthcheck is reported either way. Past revisions are on the
      <a
        class="text-accent underline"
        href={resolve("/(protected)/services/[serviceId]/revisions", {
          serviceId: svc.id,
        })}
      >Revisions</a>
      tab.
    {/snippet}
    {#snippet trailing()}
      <SaveButton form="auto-rollback" pending={submitting} />
    {/snippet}
  </PanelHeader>

  <form
    id="auto-rollback"
    action="?/updateAutoRollback"
    class="space-y-3 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save auto-rollback.",
      loading: "Saving auto-rollback",
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
      checked={svc.autoRollback}
      helperText="When the new revision is unhealthy, redeploy the previous healthy revision automatically instead of leaving it running."
      id="autoRollback"
      label="Auto-rollback when a new revision is unhealthy"
      name="autoRollback"
    />
  </form>
</section>
