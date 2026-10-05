<script lang="ts">
	import { Activity } from "@lucide/svelte";
	import { onMount } from "svelte";
	import Alert from "#lib/components/alert.svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import TraceList from "#lib/components/tracing/trace-list.svelte";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Traces`));

	let saving = $state(false);

	const injected = $derived([
		["OTEL_EXPORTER_OTLP_ENDPOINT", data.endpoint],
		["OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf"],
		["OTEL_SERVICE_NAME", svc.slug],
		["OTEL_TRACES_EXPORTER", "otlp"],
		["OTEL_RESOURCE_ATTRIBUTES", `homerun.service.id=${svc.id}`],
	]);

	function traceHref(traceId: string): string {
		return resolve(
			"/(protected)/services/[serviceId]/observability/traces/[traceId]",
			{ serviceId: svc.id, traceId },
		);
	}
</script>

<div class="space-y-6">
  {#if svc.tracesEnabled && !data.collectorEnabled}
    <Alert title="The OpenTelemetry collector is off." variant="warning">
      Spans this service sends have nowhere to go until an admin turns the
      collector on under
      <a class="underline" href={resolve("/(protected)/monitoring/settings")}>Monitoring → Settings</a>.
    </Alert>
  {/if}

  <section class="panel rounded-md">
    <PanelHeader
      description="OpenTelemetry traces from this service, kept {data.retentionDays} days."
      icon={Activity}
      title="Traces"
    >
      {#snippet trailing()}
        <SaveButton form="traces-settings" pending={saving} />
      {/snippet}
    </PanelHeader>
    <form
      id="traces-settings"
      action="?/settings"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the trace settings.",
        loading: "Saving the trace settings",
        onSettled: () => {
          saving = false;
        },
        onStart: () => {
          saving = true;
        },
        success: (result) => {
          if (!result?.changed) {
            return "Trace settings saved.";
          }
          return result.tracesEnabled
            ? "Traces are on. Redeploy the service to inject the OpenTelemetry variables."
            : "Traces are off. Redeploy the service to stop injecting the OpenTelemetry variables.";
        },
      })}
    >
      <CheckBox
        checked={svc.tracesEnabled}
        helperText="On the next deploy, Homerun points the service's OpenTelemetry SDK at its collector. Variables you set yourself win."
        id="tracesEnabled"
        label="Collect traces"
        name="tracesEnabled"
      />
      <details>
        <summary class="text-text cursor-pointer text-sm font-medium">Injected variables</summary>
        <dl class="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {#each injected as [key, value] (key)}
            <dt class="text-text-subtle font-mono break-all">{key}</dt>
            <dd class="text-text font-mono break-all">{value}</dd>
          {/each}
        </dl>
        <p class="text-text-subtle mt-2 text-xs">
          The collector also takes OTLP over gRPC on port 4317, on the Homerun
          network only.
        </p>
      </details>
    </form>
  </section>

  <TraceList
    emptySubtitle={svc.tracesEnabled
      ? "Traces show up here a few seconds after the service sends its first spans."
      : "Turn traces on and redeploy to have this service's OpenTelemetry SDK report here."}
    emptyTitle="No traces yet"
    listing={data.listing}
    searched={data.searched}
    {traceHref}
  />
</div>
