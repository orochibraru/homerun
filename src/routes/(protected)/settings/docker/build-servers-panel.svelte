<script lang="ts">
	import { untrack } from "svelte";
	import {
		ANY_BUILD_SERVER,
		MAX_BUILD_CONCURRENCY,
	} from "#lib/build-servers.js";
	import CheckBox from "#lib/components/check-box.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "#lib/components/ui/select/index.js";
	import { saveToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	interface Props {
		buildConcurrency: number;
		buildOnHost: boolean;
		defaultBuildServer: string;
		servers: { id: string; name: string }[];
	}

	const { buildConcurrency, buildOnHost, defaultBuildServer, servers }: Props =
		$props();

	let defaultServer = $state(untrack(() => defaultBuildServer));
	const defaultLabel = $derived(
		defaultServer === ANY_BUILD_SERVER
			? "Any free build server"
			: (servers.find((s) => s.id === defaultServer)?.name ?? "This host"),
	);
</script>

<section class="panel rounded-md">
  <PanelHeader title="Build servers">
    {#snippet description()}
      Where git builds run when
      <a class="underline" href={resolve('remote-hosts')}>build servers</a>
      are registered. Each service picks its own on its Source tab; these are
      the defaults.
    {/snippet}
    {#snippet trailing()}
      <SaveButton form="build-servers" />
    {/snippet}
  </PanelHeader>
  <form
    id="build-servers"
    action="?/updateBuildServers"
    class="space-y-4 p-5"
    method="POST"
    use:enhance={saveToast("Build server settings")}
  >
    <div>
      <label class={label} for="buildConcurrency">
        Concurrent builds per server
      </label>
      <Input
        id="buildConcurrency"
        max={MAX_BUILD_CONCURRENCY}
        min={0}
        name="buildConcurrency"
        required
        type="number"
        value={buildConcurrency}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        0 for no limit. A server can set its own on its page. A deploy that
        finds its server full waits for a free slot.
      </p>
    </div>
    <div>
      <label class={label} for="defaultBuildServer">
        Default for new services
      </label>
      <SelectRoot
        name="defaultBuildServer"
        type="single"
        bind:value={defaultServer}
      >
        <SelectTrigger id="defaultBuildServer">{defaultLabel}</SelectTrigger>
        <SelectContent>
          <SelectItem label="This host" value="" />
          <SelectItem label="Any free build server" value={ANY_BUILD_SERVER} />
          {#each servers as server (server.id)}
            <SelectItem label={server.name} value={server.id} />
          {/each}
        </SelectContent>
      </SelectRoot>
    </div>
    <CheckBox
      checked={buildOnHost}
      helperText="Off sends every git build that would run here to the least busy build server instead. With no build server registered, builds still run here."
      id="buildOnHost"
      label="Build on this host"
      name="buildOnHost"
    />
  </form>
</section>
