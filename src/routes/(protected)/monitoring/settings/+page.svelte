<script lang="ts">
	import { Activity } from "@lucide/svelte";
	import { onMount } from "svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import {
		OTEL_COLLECTOR_HOST,
		OTEL_GRPC_PORT,
		OTEL_HTTP_PORT,
	} from "#lib/tracing/env.js";
	import { enhance } from "$app/forms";

	const { data } = $props();

	onMount(() => title.set("Monitoring · Settings"));

	let saving = $state(false);

	const facts = $derived([
		["Container", data.status.running ? "Running" : "Not running"],
		["OTLP over HTTP", `http://${OTEL_COLLECTOR_HOST}:${OTEL_HTTP_PORT}`],
		["OTLP over gRPC", `${OTEL_COLLECTOR_HOST}:${OTEL_GRPC_PORT}`],
		["Exports to", data.status.appOrigin ?? "Unknown"],
	]);
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="Receives traces from services on the Homerun network and stores them here."
    icon={Activity}
    title="OpenTelemetry collector"
  >
    {#snippet trailing()}
      <SaveButton form="tracing-settings" pending={saving} />
    {/snippet}
  </PanelHeader>
  <form
    id="tracing-settings"
    action="?/save"
    class="space-y-5 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save the tracing settings.",
      loading: "Saving the tracing settings",
      onSettled: () => {
        saving = false;
      },
      onStart: () => {
        saving = true;
      },
      success: (result) =>
        result?.collectorEnabled
          ? "Tracing settings saved. The collector is running."
          : "Tracing settings saved. The collector is off.",
    })}
  >
    <CheckBox
      checked={data.status.enabled}
      helperText="Runs the collector as a Homerun container, reachable from services on the Homerun network only, never published through Traefik. Services opt in from their Observability → Traces section. Homerun's own job traces are recorded either way."
      id="collectorEnabled"
      label="Run the OpenTelemetry collector"
      name="collectorEnabled"
    />

    <dl class="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {#each facts as [name, value] (name)}
        <div class="min-w-0">
          <dt class="text-text-muted text-xs">{name}</dt>
          <dd class="text-text mt-0.5 truncate font-mono text-xs" title={value}>{value}</dd>
        </div>
      {/each}
    </dl>

    <div class="w-full sm:w-64">
      <label class="text-text mb-1.5 block text-sm font-medium" for="retentionDays">Keep traces for (days)</label>
      <Input
        id="retentionDays"
        max={data.limits.max}
        min={data.limits.min}
        name="retentionDays"
        required
        type="number"
        value={String(data.status.retentionDays)}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        Spans older than this are deleted every hour, for services and Homerun alike.
      </p>
    </div>
  </form>
</section>
