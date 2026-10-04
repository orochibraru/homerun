<script lang="ts">
	import { untrack } from "svelte";
	import CopyBox from "#lib/components/copy-box.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import ResponsiveDialog from "#lib/components/responsive-dialog.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Checkbox } from "#lib/components/ui/checkbox/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	let {
		open = $bindable(false),
		swarmMode,
	}: { open?: boolean; swarmMode: boolean } = $props();

	let command = $state<string | null>(null);
	let buildServer = $state(true);
	let swarmNode = $state(false);

	$effect(() => {
		if (open) {
			command = null;
			buildServer = true;
			swarmNode = untrack(() => swarmMode);
		}
	});
</script>

<ResponsiveDialog
  description="Run one command on a fresh Linux server and it joins this instance: it installs Docker, then the Homerun worker in agent mode, the swarm join, or both."
  size="md"
  title="Add a server"
  bind:open
>
  {#if command}
    <div class="space-y-3">
      <p class="text-text-muted text-sm">
        Run this as root on the server. The token works once and expires in an
        hour. The server has to reach this instance, and for a build server this
        instance has to reach port 7420 on it.
      </p>
      <CopyBox label="Copy command" value={command} />
      <p class="text-text-subtle text-xs">
        Pass <code>--address=&lt;ip&gt;</code> when the server has several
        interfaces and the default route's isn't the one to use.
      </p>
    </div>
  {:else}
    <form
      action="?/enroll"
      class="space-y-4"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't create the enrollment.",
        loading: "Creating the enrollment",
        onSuccess: (result) => {
          command = (result as { command?: string } | undefined)?.command ?? null;
        },
        success: "Enrollment command ready.",
      })}
    >
      <div>
        <label class={label} for="enroll-name">Name</label>
        <Input
          id="enroll-name"
          name="name"
          placeholder="Defaults to the server's hostname"
        />
      </div>
      <div class="space-y-3">
        <label class="flex items-start gap-3">
          <Checkbox name="buildServer" bind:checked={buildServer} class="mt-0.5" />
          <span>
            <span class="text-text text-sm font-medium">Build server</span>
            <span class="text-text-subtle block text-xs">
              Git builds can run here instead of on this host.
            </span>
          </span>
        </label>
        <label class="flex items-start gap-3">
          <Checkbox
            name="swarmNode"
            bind:checked={swarmNode}
            class="mt-0.5"
            disabled={!swarmMode}
          />
          <span>
            <span class="text-text text-sm font-medium">Swarm node</span>
            <span class="text-text-subtle block text-xs">
              {swarmMode
                ? "Joins this instance's swarm as a worker, so swarm services' replicas can be scheduled on it."
                : "Needs swarm mode: switch Settings → Docker to Swarm first."}
            </span>
          </span>
        </label>
      </div>
      <div class="flex justify-end">
        <Button disabled={!(buildServer || swarmNode)} type="submit">
          Generate command
        </Button>
      </div>
    </form>
  {/if}
</ResponsiveDialog>
