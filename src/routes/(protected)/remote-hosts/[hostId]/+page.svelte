<script lang="ts">
	import { ChevronDown, ChevronLeft, Server, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	onMount(() => title.set(data.host.name));

	let showTls = $state(false);
	let submitting = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteForm: HTMLFormElement | undefined = $state();
</script>

<div class="mx-auto max-w-2xl p-6 md:p-8">
  <a
    class="mb-4 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
    href={resolve("/remote-hosts")}
  >
    <ChevronLeft class="size-4" />
    Remote Hosts
  </a>

  <div class="mb-6 flex items-center gap-3">
    <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
      <Server class="size-5" />
    </div>
    <div class="min-w-0">
      <h1 class="truncate text-xl font-bold text-text">{data.host.name}</h1>
      <p class="text-sm text-text-muted">
        {data.host.kind === "agent" ? "Homerun Agent" : "Direct Docker connection"}
      </p>
    </div>
  </div>

  {#if data.host.kind === "agent"}
    <div class="mb-6 flex items-center gap-2 rounded-xl border border-border bg-surface p-4 text-sm">
      {#if data.agentStatus?.reachable}
        <span class="inline-block size-2 rounded-full bg-green-500"></span>
        <span class="text-text">Online</span>
        <span class="text-text-subtle">· agent v{data.agentStatus.version}</span>
      {:else}
        <span class="inline-block size-2 rounded-full bg-red-500"></span>
        <span class="text-red-600 dark:text-red-400">
          Unreachable{data.agentStatus?.error ? ` : ${data.agentStatus.error}` : ""}
        </span>
      {/if}
    </div>
  {/if}

  <form
    class="mb-6 space-y-4 rounded-2xl border border-border bg-surface p-5"
    action="?/update"
    method="POST"
    use:enhance={() => {
      submitting = true;
      return async ({ result, update }) => {
        submitting = false;
        if (result.type === "success") {
          toast.success("Remote host updated.");
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string })?.error
              ?? "Check the form for errors.",
          );
        }
        await update();
      };
    }}
  >
    {#if form?.error}
      <p class="text-sm text-red-500">{form.error}</p>
    {/if}
    <div>
      <label class={label} for="name">Name</label>
      <Input id="name" name="name" required type="text" value={data.host.name} />
    </div>

    {#if data.host.kind === "agent"}
      <div>
        <label class={label} for="agentUrl">Agent URL</label>
        <Input
          class="font-mono"
          id="agentUrl"
          name="agentUrl"
          placeholder="http://192.168.1.50:7420"
          required
          type="text"
          value={data.host.agentUrl}
        />
        <p class="mt-1.5 text-xs text-text-subtle">
          The agent's own reachable base URL, printed on its own boot log.
        </p>
      </div>
      <div>
        <label class={label} for="agentToken">Agent token</label>
        <Input
          class="font-mono"
          id="agentToken"
          name="agentToken"
          placeholder="Leave blank to keep current"
          type="password"
        />
        <p class="mt-1.5 text-xs text-text-subtle">
          Only needed if the agent's token changed, or the URL above did :
          both get re-verified whenever either one moves.
        </p>
      </div>
    {:else}
      <div>
        <label class={label} for="dockerHost">Docker host</label>
        <Input
          class="font-mono"
          id="dockerHost"
          name="dockerHost"
          placeholder="tcp://192.168.1.50:2376"
          required
          type="text"
          value={data.host.dockerHost}
        />
        <p class="mt-1.5 text-xs text-text-subtle">
          <code>tcp://host:port</code>
          (add TLS certs below for a TLS-secured daemon) or
          <code>ssh://user@host</code>
          (uses the system's own SSH agent : no key field here).
        </p>
      </div>

      <Button
        class="h-auto p-0"
        onclick={() => {
          showTls = !showTls;
        }}
        variant="link"
      >
        <ChevronDown
          class="size-3.5 transition-transform {showTls ? 'rotate-180' : ''}"
        />
        TLS client certificate (optional, tcp:// only)
      </Button>
      {#if showTls}
        <div class="space-y-3">
          <div>
            <label class={label} for="tlsCa">CA certificate</label>
            <Textarea
              class="resize-none font-mono"
              id="tlsCa"
              name="tlsCa"
              placeholder="Leave blank to keep current"
              rows={3}
            />
          </div>
          <div>
            <label class={label} for="tlsCert">Client certificate</label>
            <Textarea
              class="resize-none font-mono"
              id="tlsCert"
              name="tlsCert"
              placeholder="Leave blank to keep current"
              rows={3}
            />
          </div>
          <div>
            <label class={label} for="tlsKey">Client key</label>
            <Textarea
              class="resize-none font-mono"
              id="tlsKey"
              name="tlsKey"
              placeholder="Leave blank to keep current"
              rows={3}
            />
          </div>
        </div>
      {/if}
    {/if}

    <CheckBox
      checked={data.host.isBuildServer}
      helperText="Lets this host be picked as a git-based service's build server (Source tab), separate from being picked as a deploy target."
      id="isBuildServer"
      label="Available as a build server"
      name="isBuildServer"
    />

    <div class="flex justify-end gap-3">
      <Button disabled={submitting} type="submit" variant="outline">
        Save changes
      </Button>
    </div>
  </form>

  <div class="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
    <h2 class="text-sm font-semibold text-text">Danger zone</h2>
    <p class="mt-1 text-xs text-text-muted">
      Services deployed to this host keep running there : they just won't be
      manageable from here anymore.
    </p>
    <form
      class="mt-3"
      action="?/delete"
      method="POST"
      bind:this={deleteForm}
      use:enhance={() => async ({ result }) => {
        if (result.type === "failure") {
          toast.error("Couldn't delete the host.");
        } else if (result.type === "redirect") {
          toast.success("Remote host deleted.");
          await goto(result.location);
        }
      }}
    >
      <Button
        onclick={() => {
          deleteDialogOpen = true;
        }}
        type="button"
        variant="destructive"
      >
        <Trash2 class="size-4" />
        Delete this host
      </Button>
    </form>
  </div>
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${data.host.name}"? Services deployed to it keep running there : they just won't be manageable from here anymore.`}
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete remote host"
/>
