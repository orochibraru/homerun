<script lang="ts">
	import { ArrowLeft, Check } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CronJobFields from "$lib/components/cron-job-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("New Cron Job"));

	let submitting = $state(false);
</script>

<div class="space-y-6 p-6 md:p-8">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1.5 text-sm"
    href={resolve("/cron-jobs")}
  >
    <ArrowLeft class="size-3.5" />
    Cron Jobs
  </a>

  <div>
    <h1 class="text-text text-xl font-semibold tracking-tight">New Cron Job</h1>
    <p class="text-text-muted mt-0.5 text-sm">
      Runs on a 5-field cron schedule, through the same job queue as deploys
      and backups.
    </p>
  </div>

  {#if form?.error}
    <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
      {form.error}
    </div>
  {/if}

  <form
    action="?/create"
    class="space-y-4"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't create that cron job.",
      loading: "Creating the cron job",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Cron job created.",
    })}
  >
    <CronJobFields
      canUseExec={data.canUseExec}
      values={{
        command: null,
        description: null,
        enabled: true,
        envVars: {},
        image: null,
        kind: "image",
        name: "",
        registryUrl: null,
        registryUsername: null,
        schedule: "0 3 * * *",
        tag: "latest",
        timeoutSeconds: 900,
      }}
    />

    <Button disabled={submitting} type="submit">
      {#if submitting}
        <Spinner />
      {:else}
        <Check class="size-4" />
      {/if}
      Create cron job
    </Button>
  </form>
</div>
