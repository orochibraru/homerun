<script lang="ts">
	import { ChevronDown } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import CopyBox from "#lib/components/copy-box.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { Textarea } from "#lib/components/ui/textarea/index.js";
	import { testAgentConnection } from "#lib/remote/remote-hosts.remote.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast, toastError } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data, form } = $props();

	onMount(() => title.set("Remote Hosts"));

	let kind = $state<"docker" | "agent">("docker");
	let showTls = $state(false);
	let submitting = $state(false);
	let agentUrl = $state("");
	let agentToken = $state("");
	let testing = $state(false);

	async function testCallback() {
		testing = true;
		try {
			await testAgentConnection({
				agentToken: agentToken.trim(),
				agentUrl: agentUrl.trim(),
			});
		} finally {
			testing = false;
		}
	}

	function handleTest() {
		return toast.promise(testCallback(), {
			error: (error) => toastError(error, "Couldn't reach the agent."),
			loading: "Testing the connection",
			success: "Agent reachable, token accepted.",
		});
	}
</script>

<div class="p-5 md:p-6">
    <div class="mb-8 flex items-center justify-between gap-4">
        <div>
            <h1 class="text-text text-lg font-semibold tracking-tight">Add a new remote host</h1>
            <p class="mt-1 text-sm text-text-muted">
                Fill in the form below to add a remote docker host.
            </p>
        </div>
    </div>

    <form
        action="?/create"
        class="mb-6 space-y-4 rounded-md panel p-5"
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
            onSuccess: () => goto(resolve('remote-hosts'), { refreshAll: true }),
            success: "Remote host added."
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
                    class="rounded-md border p-3 text-left text-sm transition-colors {kind ===
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
                    class="rounded-md border p-3 text-left text-sm transition-colors {kind ===
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
                        A host running homerun-worker in agent mode.
                    </p>
                </button>
            </div>
        </div>

        {#if kind === "agent"}
            <div class="space-y-3 rounded-md border border-border p-4">
                <p class="text-text text-sm font-medium">Set up the agent</p>
                <p class="text-text-muted text-xs">
                    Fresh Linux server? Skip this form:
                    <b>Add a server</b>
                    on

                    <a
                        class="text-accent underline"
                        href={resolve('remote-hosts')}
                    >Remote Hosts</a>

                    hands you one command that installs and registers it. Otherwise, on the build host, either:
                </p>
                <div class="space-y-1.5">
                    <p class="text-text-subtle text-xs">
                        Linux, with the installer (sets up rootless Docker too):
                    </p>
                    <CopyBox label="Copy command" value={data.agentCommands.installer} />
                    <p class="text-text-subtle text-xs">Then read its token:</p>
                    <CopyBox label="Copy command" value={data.agentCommands.installerToken} />
                </div>
                <div class="space-y-1.5">
                    <p class="text-text-subtle text-xs">
                        Docker already running (any OS, incl. Docker Desktop on macOS):
                    </p>
                    <CopyBox label="Copy command" value={data.agentCommands.docker} />
                    <p class="text-text-subtle text-xs">Then read its token:</p>
                    <CopyBox label="Copy command" value={data.agentCommands.dockerToken} />
                </div>
                <p class="text-text-subtle text-xs">
                    This instance has to reach port 7420 on that host. Builds run
                    there; the resulting service still runs here, behind Traefik.
                </p>
            </div>
            <div>
                <label class={label} for="agentUrl">Agent URL</label>
                <Input
                    id="agentUrl"
                    name="agentUrl"
                    placeholder="http://192.168.1.50:7420"
                    required
                    type="text"
                    bind:value={agentUrl}
                />
                <p class="mt-1.5 text-xs text-text-subtle">
                    The host's address as this instance sees it, port 7420 unless
                    WORKER_PORT says otherwise.
                </p>
            </div>
            <div>
                <label class={label} for="agentToken">Agent token</label>
                <Input
                    id="agentToken"
                    name="agentToken"
                    placeholder="Output of the token command above"
                    required
                    type="password"
                    bind:value={agentToken}
                />
            </div>
        {:else}
            <div>
                <label class={label} for="dockerHost">Docker host</label>
                <Input
                    class=""
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
                            class="resize-none"
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
                            class="resize-none"
                            id="tlsCert"
                            name="tlsCert"
                            rows={3}
                        />
                    </div>
                    <div>
                        <label class={label} for="tlsKey">Client key</label>
                        <Textarea
                            class="resize-none"
                            id="tlsKey"
                            name="tlsKey"
                            rows={3}
                        />
                    </div>
                </div>
            {/if}
        {/if}

        <div class="flex justify-end gap-3">
            {#if kind === "agent"}
                <Button
                    disabled={testing || !(agentUrl.trim() && agentToken.trim())}
                    onclick={handleTest}
                    type="button"
                    variant="outline"
                >
                    Test connection
                </Button>
            {/if}
            <Button disabled={submitting} type="submit" variant="outline">
                Add host
            </Button>
        </div>
    </form>
</div>
