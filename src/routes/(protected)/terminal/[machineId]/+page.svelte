<script lang="ts">
	import { ArrowLeft, TerminalSquare } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button/index.js";
	import WebTerminal from "$lib/components/web-terminal.svelte";
	import { title } from "$lib/store/title";

	const { data } = $props();
	const machine = $derived(data.machine);

	let connected = $state(false);

	onMount(() => title.set(`${machine.name} · Terminal`));

	const sessionRoutes = {
		close: "/(protected)/terminal/session/[sessionId]/close",
		input: "/(protected)/terminal/session/[sessionId]/input",
		resize: "/(protected)/terminal/session/[sessionId]/resize",
		stream: "/(protected)/terminal/session/[sessionId]/stream",
	} as const;
</script>

<div class="flex h-full flex-col p-5 md:p-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <TerminalSquare class="text-text-muted size-5" />
      <h1 class="text-text text-lg font-semibold tracking-tight">{machine.name}</h1>
      {#if machine.ssh}
        <span class="text-text-subtle font-mono text-xs">
          {machine.ssh.user}@{machine.ssh.host}{machine.ssh.port === 22 ? "" : `:${machine.ssh.port}`}
        </span>
      {/if}
      {#if connected}
        <span class="flex items-center gap-1 text-xs text-green-600">
          <span class="size-1.5 rounded-full bg-green-500"></span>
          connected
        </span>
      {/if}
    </div>
    <Button href={resolve("/terminal")} size="sm" variant="outline">
      <ArrowLeft class="size-4" />
      Machines
    </Button>
  </div>

  {#if machine.ssh}
    <section class="panel min-h-0 flex-1 overflow-hidden rounded-md">
      <WebTerminal
        class="h-[calc(100dvh-12rem)] min-h-80"
        onState={(state) => (connected = state.connected)}
        openUrl={resolve("/(protected)/terminal/[machineId]/open", {
          machineId: machine.id,
        })}
        sessionUrl={(action, sessionId) => resolve(sessionRoutes[action], { sessionId })}
      />
    </section>
  {:else}
    <p class="text-text-muted text-sm">
      Set this machine's SSH host and user on the Terminal page first.
    </p>
  {/if}
</div>
