<script lang="ts">
	import { AlertTriangle, Terminal as TerminalIcon } from "@lucide/svelte";
	import { onMount } from "svelte";
	import WebTerminal from "#lib/components/web-terminal.svelte";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Terminal`));

	let connected = $state(false);

	const running = $derived(
		Boolean(svc.containerId || svc.swarmServiceId) &&
			svc.currentStatus === "running",
	);

	const sessionRoutes = {
		close: "/(protected)/services/[serviceId]/terminal/[sessionId]/close",
		input: "/(protected)/services/[serviceId]/terminal/[sessionId]/input",
		resize: "/(protected)/services/[serviceId]/terminal/[sessionId]/resize",
		stream: "/(protected)/services/[serviceId]/terminal/[sessionId]/stream",
	} as const;
</script>

<section class="rounded-md panel">
  <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
    <div class="flex items-center gap-2">
      <TerminalIcon class="size-4 text-text-muted" />
      <h2 class="eyebrow">Terminal</h2>
      {#if connected}
        <span class="flex items-center gap-1 text-xs text-green-600">
          <span class="size-1.5 rounded-full bg-green-500"></span>
          connected
        </span>
      {/if}
    </div>
  </div>

  <div class="flex items-start gap-2.5 border-b border-border bg-amber-50 px-5 py-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
    <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
    <p>
      Runs a shell (<code>bash</code> if the image has it, <code>sh</code>
      otherwise) inside this service's live container, with whatever access that
      shell has : anything you run here can modify or break the running service.
    </p>
  </div>

  {#if running}
    <WebTerminal
      onState={(state) => (connected = state.connected)}
      openUrl={resolve("/(protected)/services/[serviceId]/terminal/open", {
        serviceId: svc.id,
      })}
      sessionUrl={(action, sessionId) =>
        resolve(sessionRoutes[action], { serviceId: svc.id, sessionId })}
    />
  {:else}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <p class="text-sm font-medium text-text-muted">
        This service isn't running.
      </p>
      <p class="mt-1 text-xs text-text-subtle">
        Deploy or start it first : a terminal needs a live container.
      </p>
    </div>
  {/if}
</section>
