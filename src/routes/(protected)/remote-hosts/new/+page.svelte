<script lang="ts">
	import { ChevronDown } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Remote Hosts"));

	let kind = $state<"docker" | "agent">("docker");
	let showTls = $state(false);
	let submitting = $state(false);
</script>

<div class="p-6 md:p-8">
    <div class="mb-8 flex items-center justify-between gap-4">
        <div>
            <h1 class="text-text text-xl font-semibold tracking-tight">Add a new remote host</h1>
            <p class="mt-1 text-sm text-text-muted">
                Fill in the form below to add a remote docker host.
            </p>
        </div>
    </div>

    <form
        action="?/create"
        class="mb-6 space-y-4 rounded-2xl glass p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Check the form for errors.",
          loading: "Adding the host",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          onSuccess: () =>
            goto(resolve("/remote-hosts"), {
              invalidateAll: true,
            }),
          success: "Remote host added.",
        })}
    >
        {#if form?.error}
            <p class="text-sm text-red-500">{form.error}</p>
        {/if}
        <div>
            <label class={label} for="name">Name</label>
            <Input id="name" name="name" required type="text" />
        </div>

        <div>
            <span class={label}>Connection type</span>
            <input name="kind" type="hidden" value={kind} />
            <div class="mt-1.5 grid grid-cols-2 gap-2">
                <button
                    class="rounded-xl border p-3 text-left text-sm transition-colors {kind ===
                    'docker'
                        ? 'border-accent bg-accent-light text-accent'
                        : 'border-border text-text-muted hover:border-text-subtle'}"
                    onclick={() => {
                        kind = "docker";
                    }}
                    type="button"
                >
                    <p class="font-semibold">Direct Docker connection</p>
                    <p class="mt-0.5 text-xs opacity-80">
                        A raw tcp:// or ssh:// Docker socket.
                    </p>
                </button>
                <button
                    class="rounded-xl border p-3 text-left text-sm transition-colors {kind ===
                    'agent'
                        ? 'border-accent bg-accent-light text-accent'
                        : 'border-border text-text-muted hover:border-text-subtle'}"
                    onclick={() => {
                        kind = "agent";
                    }}
                    type="button"
                >
                    <p class="font-semibold">Homerun Agent</p>
                    <p class="mt-0.5 text-xs opacity-80">
                        A host running the standalone agent binary.
                    </p>
                </button>
            </div>
        </div>

        {#if kind === "agent"}
            <div
                class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400"
            >
                A remote-hosted service (docker *or* agent) isn't on the shared
                network or routed through Traefik, see the Networking tab's own
                docs for what that means in practice.
            </div>
            <div>
                <label class={label} for="agentUrl">Agent URL</label>
                <Input
                    class="font-mono"
                    id="agentUrl"
                    name="agentUrl"
                    placeholder="http://192.168.1.50:7420"
                    required
                    type="text"
                />
                <p class="mt-1.5 text-xs text-text-subtle">
                    The agent's own reachable base URL, printed on its own boot
                    log.
                </p>
            </div>
            <div>
                <label class={label} for="agentToken">Agent token</label>
                <Input
                    class="font-mono"
                    id="agentToken"
                    name="agentToken"
                    placeholder="paste the token printed by the agent on boot"
                    required
                    type="password"
                />
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
                    class="size-3.5 transition-transform {showTls
                        ? 'rotate-180'
                        : ''}"
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
                            rows={3}
                        />
                    </div>
                    <div>
                        <label class={label} for="tlsCert"
                            >Client certificate</label
                        >
                        <Textarea
                            class="resize-none font-mono"
                            id="tlsCert"
                            name="tlsCert"
                            rows={3}
                        />
                    </div>
                    <div>
                        <label class={label} for="tlsKey">Client key</label>
                        <Textarea
                            class="resize-none font-mono"
                            id="tlsKey"
                            name="tlsKey"
                            rows={3}
                        />
                    </div>
                </div>
            {/if}
        {/if}

        <CheckBox
            checked={false}
            helperText="Lets this host be picked as a git-based service's build server (Source tab), separate from being picked as a deploy target."
            id="isBuildServer"
            label="Available as a build server"
            name="isBuildServer"
        />

        <div class="flex justify-end gap-3">
            <Button disabled={submitting} type="submit" variant="outline">
                Add host
            </Button>
        </div>
    </form>
</div>
