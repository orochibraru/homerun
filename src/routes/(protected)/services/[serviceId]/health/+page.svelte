<script lang="ts">
	import { Check, HeartPulse } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const svc = $derived(data.service);
	const applied = $derived(data.applied);

	onMount(() => title.set(`${svc.name} · Health`));

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";

	const values = $derived(
		(form?.values as Record<string, string> | undefined) ?? {
			healthcheckCommand: svc.healthcheckCommand ?? "",
			healthcheckDisabled: svc.healthcheckDisabled ? "on" : "",
			healthcheckIntervalSeconds:
				svc.healthcheckIntervalSeconds?.toString() ?? "",
			healthcheckRetries: svc.healthcheckRetries?.toString() ?? "",
			healthcheckStartPeriodSeconds:
				svc.healthcheckStartPeriodSeconds?.toString() ?? "",
			healthcheckTimeoutSeconds:
				svc.healthcheckTimeoutSeconds?.toString() ?? "",
		},
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let disabled = $derived(values.healthcheckDisabled === "on");
	let submitting = $state(false);

	const source = $derived.by(() => {
		if (!applied) {
			return data.swarm
				? "Swarm service: its tasks' live healthcheck isn't shown here."
				: "No running container to read it from.";
		}
		if (!applied.test) {
			return "None: the container runs without a healthcheck.";
		}
		if (applied.generated) {
			return `Homerun's generated check: waits for port ${svc.containerPort} to be listening.`;
		}
		return svc.healthcheckCommand
			? "This service's own command."
			: "The image's own HEALTHCHECK.";
	});

	const timings = $derived(
		applied?.test
			? [
					["Interval", applied.interval, "s"],
					["Timeout", applied.timeout, "s"],
					["Retries", applied.retries, ""],
					["Start period", applied.startPeriod, "s"],
				]
			: [],
	);

	const fields = $derived([
		{
			id: "healthcheckIntervalSeconds",
			label: "Interval (s)",
			min: 1,
			placeholder: data.defaults.intervalSeconds,
		},
		{
			id: "healthcheckTimeoutSeconds",
			label: "Timeout (s)",
			min: 1,
			placeholder: data.defaults.timeoutSeconds,
		},
		{
			id: "healthcheckRetries",
			label: "Retries",
			min: 1,
			placeholder: data.defaults.retries,
		},
		{
			id: "healthcheckStartPeriodSeconds",
			label: "Start period (s)",
			min: 0,
			placeholder: data.defaults.startPeriodSeconds,
		},
	] as const);
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <PanelHeader
      description="What the running container was created with, read from Docker."
      icon={HeartPulse}
      title="Current healthcheck"
    />
    <div class="space-y-4 p-5">
      <div class="flex flex-wrap items-center gap-3">
        <p class="text-text text-sm">{source}</p>
        {#if applied?.status}
          <span
            class="rounded-full px-2 py-0.5 text-[0.6875rem] font-medium uppercase {applied.status ===
            'healthy'
              ? 'bg-green-500/10 text-green-600'
              : applied.status === 'unhealthy'
                ? 'bg-red-500/10 text-red-500'
                : 'bg-surface-2 text-text-muted'}"
          >
            {applied.status}
          </span>
        {/if}
      </div>

      {#if applied?.test}
        <pre class="bg-surface-2 text-text overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">{applied.test}</pre>
        <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {#each timings as [name, value, unit] (name)}
            <div>
              <dt class="text-text-subtle text-xs">{name}</dt>
              <dd class="text-text font-mono text-sm">
                {value === null ? "Docker default" : `${value}${unit}`}
              </dd>
            </div>
          {/each}
        </dl>
      {/if}

      {#if applied && applied.log.length > 0}
        <div>
          <p class="text-text-subtle mb-1.5 text-xs">Last probes</p>
          <ul class="divide-border border-border divide-y rounded-md border">
            {#each applied.log.toReversed() as entry, i (i)}
              <li class="flex gap-3 px-3 py-2 font-mono text-xs">
                <span class={entry.exitCode === 0 ? "text-green-600" : "text-red-500"}>
                  exit {entry.exitCode ?? "?"}
                </span>
                <span class="text-text-subtle shrink-0">
                  {entry.at ? new Date(entry.at).toLocaleTimeString() : ""}
                </span>
                <span class="text-text-muted min-w-0 break-all">
                  {entry.output ?? ""}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </section>

  <section class="panel rounded-md">
    <PanelHeader
      description="Overrides for this service. Leave a field blank for the default. Redeploy for changes to take effect."
      icon={HeartPulse}
      title="Healthcheck settings"
    />
    <form
      action="?/updateHealth"
      class="space-y-5 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving healthcheck settings",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Saved. Redeploy to apply.",
      })}
    >
      <CheckBox
        helperText="No healthcheck at all: the image's own is overridden, Homerun adds no port check, and a deploy doesn't wait on the service's HTTP answer. Use it for workers that don't listen on anything."
        id="healthcheckDisabled"
        label="Turn off healthchecks"
        name="healthcheckDisabled"
        bind:checked={disabled}
      />

      <div class="space-y-5 transition-opacity {disabled ? 'opacity-50' : ''}">
        <div>
          <label class={label} for="healthcheckCommand">Command</label>
          <Input
            id="healthcheckCommand"
            name="healthcheckCommand"
            placeholder="curl -fsS http://127.0.0.1:8080/health"
            type="text"
            value={values.healthcheckCommand}
          />
          <p class="text-text-subtle mt-1.5 text-xs">
            Runs inside the container through the shell, exit 0 means healthy.
            Overrides the image's own healthcheck, drives this service's uptime
            probe and gates traffic: a new container or swarm task only gets
            traffic once it passes. Leave blank to keep the image's; with
            neither, Homerun waits for the port to be listening instead.
          </p>
          {#if errors?.healthcheckCommand}
            <p class={errorClass}>{errors.healthcheckCommand[0]}</p>
          {/if}
        </div>

        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {#each fields as field (field.id)}
            <div>
              <label class={label} for={field.id}>{field.label}</label>
              <Input
                id={field.id}
                min={field.min}
                name={field.id}
                placeholder={String(field.placeholder)}
                type="number"
                value={values[field.id]}
              />
              {#if errors?.[field.id]}
                <p class={errorClass}>{errors[field.id][0]}</p>
              {/if}
            </div>
          {/each}
        </div>
        <p class="text-text-subtle text-xs">
          Interval, timeout and retries also apply to Homerun's generated port
          check; its start period follows the deploy's rollout window instead.
        </p>
      </div>

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
</div>
