<script lang="ts">
	import { Clock } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import ScheduleField from "#lib/components/schedule-field.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	interface Props {
		cronError?: string;
		svc: {
			cronEnabled: boolean;
			cronLastRunAt: Date | null;
			cronSchedule: string | null;
		};
	}

	const { cronError, svc }: Props = $props();

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
  <PanelHeader icon={Clock} title="Auto-redeploy schedule">
    {#snippet description()}
      Periodically repull the image and redeploy : useful for tracking a
      <code>:latest</code>
      tag. Disabled by default.
    {/snippet}
    {#snippet trailing()}
      <SaveButton form="auto-redeploy" pending={submitting} />
    {/snippet}
  </PanelHeader>

  <form
    id="auto-redeploy"
    action="?/updateCron"
    class="space-y-3 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the schedule for errors.",
      loading: "Saving the schedule",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Saved.",
    })}
  >
    {#if cronError}
      <p class="mt-1.5 text-xs text-red-500">{cronError}</p>
    {/if}

    <CheckBox
      checked={svc.cronEnabled}
      helperText="Automatically re-deploy this app"
      id="cronEnabled"
      label="Enable auto-redeploy"
      name="cronEnabled"
    />
    <ScheduleField
      id="cronSchedule"
      name="cronSchedule"
      value={svc.cronSchedule}
    />
    {#if svc.cronLastRunAt}
      <p class="text-text-subtle text-xs">
        Last run {timeAgo(svc.cronLastRunAt)}.
      </p>
    {/if}
  </form>
</section>
