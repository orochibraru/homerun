<script lang="ts">
	import { Clock } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
	import ScheduleField from "$lib/components/schedule-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { timeAgo } from "$lib/formatting";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		cronError?: string;
		svc: {
			cronEnabled: boolean;
			cronLastRunAt: Date | null;
			cronSchedule: string | null;
		};
	}

	const { cronError, svc }: Props = $props();
</script>

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
      <Clock class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">Auto-redeploy schedule</p>
      <p class="text-text-muted text-xs">
        Periodically repull the image and redeploy : useful for tracking a
        <code>:latest</code>
        tag. Disabled by default.
      </p>
    </div>
  </div>

  <form
    action="?/updateCron"
    class="space-y-3"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the schedule for errors.",
      loading: "Saving the schedule",
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
    <Button type="submit" variant="outline">Save schedule</Button>
  </form>
</section>
