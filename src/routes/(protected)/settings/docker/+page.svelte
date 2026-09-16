<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
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
	import { BLOCK_SEVERITY_OPTIONS } from "$lib/image-scan";
	import { getSetupStatus } from "$lib/remote/setup.remote";
	import { enhanceToast, saveToast } from "$lib/toast";

	const { data } = $props();

	const setup = getSetupStatus();
	const issuesByField = $derived(setup.current?.issuesByField ?? {});

	const highlighted = $derived(
		new Set(
			(page.url.searchParams.get("highlight") ?? "").split(",").filter(Boolean),
		),
	);
	function highlightClass(field: string): string {
		return highlighted.has(field) ? "ring-2 ring-amber-400" : "";
	}
	function issueFor(field: string): string | undefined {
		return highlighted.has(field) ? issuesByField[field] : undefined;
	}

	onMount(() => {
		const [first] = highlighted;
		if (first) {
			document
				.getElementById(first)
				?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	});

	let orchestrationMode = $state(
		untrack(() => data.settings.orchestrationMode ?? "standalone"),
	);

	let blockSeverity = $state<string>(
		untrack(() => data.settings.imageScanBlockSeverity ?? "off"),
	);
	const blockOption = $derived(
		BLOCK_SEVERITY_OPTIONS.find((option) => option.value === blockSeverity) ??
			BLOCK_SEVERITY_OPTIONS[0],
	);
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
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
          class={highlightClass('dockerSocketPath')}
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
          class=""
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

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Image scanning</h2>
      <p class="text-text-muted text-xs">
        Every deploy copies the image into a Homerun-managed registry mirror
        (<code>homerun-mirror</code>, published on
        <code>127.0.0.1:5055</code> only), scans it there with Trivy, and only
        then pulls it onto this host. If the mirror can't be used the deploy
        pulls directly and scans the local image instead. Git builds are
        scanned once built. Each service can opt out on its own Settings tab.
        The mirror is garbage-collected daily; its size and a manual cleanup
        are on <a class="underline" href={resolve("/docker-cleanup")}
        >Docker Cleanup</a>.
      </p>
    </div>
    <form
      action="?/updateImageScan"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={saveToast("Image scanning settings")}
    >
      <CheckBox
        checked={data.settings.imageScanEnabled ?? true}
        helperText="Turning this off skips the mirror and the scan for every service."
        id="imageScanEnabled"
        label="Scan images before deploying"
        name="imageScanEnabled"
      />
      <div>
        <label class={label} for="imageScanBlockSeverity"
        >Block deploys at severity</label>
        <SelectRoot
          name="imageScanBlockSeverity"
          type="single"
          bind:value={blockSeverity}
        >
          <SelectTrigger id="imageScanBlockSeverity">
            {blockOption.label}
          </SelectTrigger>
          <SelectContent>
            {#each BLOCK_SEVERITY_OPTIONS as option (option.value)}
              <SelectItem label={option.label} value={option.value} />
            {/each}
          </SelectContent>
        </SelectRoot>
        <p class="text-text-subtle mt-1.5 text-xs">
          {blockOption.description} A scanner that fails to run never blocks a
          deploy.
        </p>
      </div>
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Orchestration</h2>
      <p class="text-text-muted text-xs">
        "Standalone" is a single container per service (this app's original
        model). "Swarm" deploys every service as a replicated, self-healing
        Docker Swarm service instead : scale via the Replicas field on a
        service's Compute tab, restarts are rolling force-updates. Saving
        <strong>Swarm</strong> prepares this host for it : <code
        >docker swarm init</code
        > if the daemon isn't a manager yet, an attachable overlay network
        (<code>{data.settings.dockerNetworkName
        ?? data.envDefaults.dockerNetworkName}-swarm</code
        >, since the shared bridge network can't be converted in place),
        Traefik attached to it, and Traefik's swarm provider turned on. That
        last step recreates the Traefik container, so this page may blink if
        you reach it through Traefik. Switching back turns the provider off
        again and leaves the swarm itself alone. Remote Hosts aren't part of
        the cluster : a swarm-mode service can only deploy locally.
      </p>
    </div>
    <form
      action="?/updateOrchestration"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't apply the orchestration mode.",
        loading: "Applying the orchestration mode",
        success: (data) =>
          (data?.orchestrationSteps as string[] | undefined)?.at(-1) ??
          "Orchestration settings saved.",
      })}
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

</div>
