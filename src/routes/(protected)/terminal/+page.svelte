<script lang="ts">
	import { KeyRound, Server, TerminalSquare } from "@lucide/svelte";
	import { onMount } from "svelte";
	import CopyBox from "#lib/components/copy-box.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { title } from "#lib/store/title.js";
	import { saveToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set("Terminal"));
</script>

<div class="p-5 md:p-6">
  <div class="mb-6">
    <h1 class="text-text text-lg font-semibold tracking-tight">Terminal</h1>
    <p class="text-text-muted mt-1 text-sm">
      A shell on this server or any remote host, over SSH, in the browser.
    </p>
  </div>

  <section class="panel mb-6 rounded-md">
    <div class="border-border flex items-center gap-2 border-b px-5 py-4">
      <KeyRound class="text-text-muted size-4" />
      <h2 class="eyebrow">Homerun's key</h2>
    </div>
    <div class="space-y-3 p-5">
      <p class="text-text-muted text-sm">
        Add this line to <code>~/.ssh/authorized_keys</code> for the user you
        connect as, on every machine. The private half never leaves this
        instance, stored encrypted.
      </p>
      <CopyBox label="Copy public key" truncate value={data.publicKey} />
      <CopyBox
        label="Copy command"
        truncate
        value={`mkdir -p ~/.ssh && echo '${data.publicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`}
      />
    </div>
  </section>

  <div class="grid gap-4 lg:grid-cols-2">
    {#each data.machines as machine (machine.id)}
      <section class="panel rounded-md">
        <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
          <div class="flex min-w-0 items-center gap-2">
            <Server class="text-text-muted size-4 shrink-0" />
            <div class="min-w-0">
              <h2 class="text-text truncate text-sm font-medium">{machine.name}</h2>
              {#if machine.detail}
                <p class="text-text-subtle truncate text-xs">{machine.detail}</p>
              {/if}
            </div>
          </div>
          {#if machine.ssh}
            <Button
              href={resolve("/(protected)/terminal/[machineId]", {
                machineId: machine.id,
              })}
              size="sm"
            >
              <TerminalSquare class="size-4" />
              Open terminal
            </Button>
          {/if}
        </div>
        <form
          action="?/configure"
          class="grid gap-3 p-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          method="POST"
          use:enhance={saveToast(`${machine.name}'s SSH settings`)}
        >
          <input name="machineId" type="hidden" value={machine.id} />
          <div>
            <label class={label} for="host-{machine.id}">Host</label>
            <Input
              id="host-{machine.id}"
              name="host"
              placeholder={machine.id === "local" ? "host.docker.internal" : "10.0.0.5"}
              value={machine.ssh?.host ?? ""}
            />
          </div>
          <div>
            <label class={label} for="user-{machine.id}">User</label>
            <Input
              id="user-{machine.id}"
              name="user"
              placeholder="deploy"
              value={machine.ssh?.user ?? ""}
            />
          </div>
          <div>
            <label class={label} for="port-{machine.id}">Port</label>
            <Input
              id="port-{machine.id}"
              inputmode="numeric"
              name="port"
              placeholder="22"
              value={machine.ssh?.port === 22 ? "" : (machine.ssh?.port ?? "")}
            />
          </div>
          <Button type="submit" variant="outline">Save</Button>
          {#if machine.ssh?.hostKey}
            <p class="text-text-subtle col-span-full truncate text-xs" title={machine.ssh.hostKey}>
              Trusts host key {machine.ssh.hostKey.slice(0, 40)}…
            </p>
          {:else if machine.ssh}
            <p class="text-text-subtle col-span-full text-xs">
              Its host key is recorded on the first connection and checked on
              every one after.
            </p>
          {/if}
        </form>
      </section>
    {/each}
  </div>
</div>
