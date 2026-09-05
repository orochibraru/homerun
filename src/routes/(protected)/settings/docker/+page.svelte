<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { saveToast } from "$lib/toast";

	const { data } = $props();

	const highlighted = $derived(
		new Set(
			(page.url.searchParams.get("highlight") ?? "").split(",").filter(Boolean),
		),
	);
	function highlightClass(field: string): string {
		return highlighted.has(field) ? "ring-2 ring-amber-400" : "";
	}
	function issueFor(field: string): string | undefined {
		return highlighted.has(field) ? data.fieldIssues[field] : undefined;
	}

	onMount(() => {
		const [first] = highlighted;
		if (first) {
			document
				.getElementById(first)
				?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	});

	let autoscaleOverflowRemoteHostId = $state(
		untrack(() => data.settings.autoscaleOverflowRemoteHostId ?? ""),
	);
	const autoscaleOverflowRemoteHostLabel = $derived(
		data.remoteHosts.find((h) => h.id === autoscaleOverflowRemoteHostId)
			?.name ?? "Choose a remote host…",
	);
	let orchestrationMode = $state(
		untrack(() => data.settings.orchestrationMode ?? "standalone"),
	);
</script>

<div class="space-y-6">
  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Docker</h2>
      <p class="text-text-muted text-xs">
        The default local connection : separate from the per-service "Deploy
        target" picker on Remote Hosts.
      </p>
    </div>
    <form
      action="?/updateDocker"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={saveToast("Docker settings")}
    >
      <div>
        <label class={label} for="dockerSocketPath">Socket path</label>
        <Input
          class="font-mono {highlightClass('dockerSocketPath')}"
          id="dockerSocketPath"
          name="dockerSocketPath"
          placeholder={data.envDefaults.dockerSocketPath}
          type="text"
          value={data.settings.dockerSocketPath ?? ""}
        />
        {#if issueFor("dockerSocketPath")}
          <p class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            ⚠ {issueFor("dockerSocketPath")}
          </p>
        {/if}
      </div>
      <div>
        <label class={label} for="dockerNetworkName"
        >Shared network name</label>
        <Input
          class="font-mono"
          id="dockerNetworkName"
          name="dockerNetworkName"
          placeholder={data.envDefaults.dockerNetworkName}
          type="text"
          value={data.settings.dockerNetworkName ?? ""}
        />
      </div>
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Orchestration</h2>
      <p class="text-text-muted text-xs">
        "Standalone" is a single container per service (this app's original
        model). "Swarm" deploys every service as a replicated, self-healing
        Docker Swarm service instead : scale via the Replicas field on a
        service's Compute tab, restarts are rolling force-updates. Requires
        this host's own Docker daemon to already be swarm-active (<code
        >docker swarm init</code
        >, your own one-time step, this app never runs that itself) and
        Traefik configured with <code
        >--providers.docker.swarmMode=true</code
        >. Remote Hosts aren't part of the swarm cluster : a swarm-mode
        service can only deploy locally.
      </p>
    </div>
    <form
      action="?/updateOrchestration"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={saveToast("Orchestration settings")}
    >
      <div>
        <label class={label} for="orchestrationMode">Mode</label>
        <SelectRoot
          name="orchestrationMode"
          type="single"
          bind:value={orchestrationMode}
        >
          <SelectTrigger id="orchestrationMode">
            {orchestrationMode === "swarm" ? "Swarm" : "Standalone"}
          </SelectTrigger>
          <SelectContent>
            <SelectItem label="Standalone" value="standalone" />
            <SelectItem label="Swarm" value="swarm" />
          </SelectContent>
        </SelectRoot>
      </div>
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Autoscaling</h2>
      <p class="text-text-muted text-xs">
        "GCP Cloud Run"-style load shedding : when this host crosses a
        resource threshold, one autoscale-eligible service (opt in from its
        Compute tab) gets migrated onto the overflow remote host below. This
        moves the service, it doesn't run a second replica of it : off by
        default, and inert unless both enabled here and opted into
        per-service.
      </p>
    </div>
    <form
      action="?/updateAutoscale"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={saveToast("Autoscaling settings")}
    >
      <CheckBox
        checked={data.settings.autoscaleEnabled}
        helperText="Allow the autoscale scheduler to migrate eligible services off this host"
        id="autoscaleEnabled"
        label="Enable autoscaling"
        name="autoscaleEnabled"
      />
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class={label} for="autoscaleCpuThresholdPercent">
            CPU threshold (%)
          </label>
          <Input
            id="autoscaleCpuThresholdPercent"
            max="99"
            min="1"
            name="autoscaleCpuThresholdPercent"
            type="number"
            value={data.settings.autoscaleCpuThresholdPercent}
          />
        </div>
        <div>
          <label class={label} for="autoscaleMemoryThresholdPercent">
            Memory threshold (%)
          </label>
          <Input
            id="autoscaleMemoryThresholdPercent"
            max="99"
            min="1"
            name="autoscaleMemoryThresholdPercent"
            type="number"
            value={data.settings.autoscaleMemoryThresholdPercent}
          />
        </div>
      </div>
      <div>
        <p class={label}>Overflow remote host</p>
        {#if data.remoteHosts.length === 0}
          <p class="text-text-subtle text-xs">
            No remote hosts registered yet : add one on the Remote Hosts page
            first.
          </p>
        {:else}
          <SelectRoot
            name="autoscaleOverflowRemoteHostId"
            type="single"
            bind:value={autoscaleOverflowRemoteHostId}
          >
            <SelectTrigger class="w-full">
              {autoscaleOverflowRemoteHostLabel}
            </SelectTrigger>
            <SelectContent>
              <SelectItem label="None" value="" />
              {#each data.remoteHosts as host (host.id)}
                <SelectItem label={host.name} value={host.id} />
              {/each}
            </SelectContent>
          </SelectRoot>
        {/if}
      </div>
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>
</div>
