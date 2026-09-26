<script lang="ts">
	import { RotateCcw } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		svc: { autoRollback: boolean; id: string };
	}

	const { svc }: Props = $props();
</script>

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
      <RotateCcw class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">Auto-rollback</p>
      <p class="text-text-muted text-xs">
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
      </p>
    </div>
  </div>
  <form
    action="?/updateAutoRollback"
    class="space-y-3"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save auto-rollback.",
      loading: "Saving auto-rollback",
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
    <Button type="submit" variant="outline">Save</Button>
  </form>
</section>
