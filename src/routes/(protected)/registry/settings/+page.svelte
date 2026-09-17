<script lang="ts">
	import { enhance } from "$app/forms";
	import Alert from "$lib/components/alert.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { formatBytes } from "$lib/formatting";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	let publicHost = $state("");
	$effect(() => {
		publicHost = data.status.publicHost ?? "";
	});
	let authForm: HTMLFormElement | undefined = $state();
</script>

<section class="border-border bg-surface-1 mb-6 rounded-lg border p-4">
  <h2 class="text-text text-sm font-medium">Status</h2>
  <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
    <div>
      <dt class="text-text-muted text-xs">Container</dt>
      <dd class="text-text mt-0.5">
        {data.status.running ? "Running" : "Not running"}
      </dd>
    </div>
    <div>
      <dt class="text-text-muted text-xs">Disk used</dt>
      <dd class="text-text mt-0.5">
        {data.status.sizeBytes === null
          ? "Unknown"
          : formatBytes(data.status.sizeBytes)}
      </dd>
    </div>
    <div>
      <dt class="text-text-muted text-xs">Internal address</dt>
      <dd class="text-text mt-0.5 font-mono text-xs">
        {data.status.internalEndpoint}
      </dd>
    </div>
    <div>
      <dt class="text-text-muted text-xs">Tokens</dt>
      <dd class="text-text mt-0.5">{data.status.tokenCount}</dd>
    </div>
  </dl>
</section>

<section class="border-border bg-surface-1 mb-6 rounded-lg border p-4">
  <div class="flex items-start justify-between gap-4">
    <div>
      <h2 class="text-text text-sm font-medium">Require authentication</h2>
      <p class="text-text-muted mt-1 text-sm">
        Turns on the registry's htpasswd auth, so only a token from the Tokens
        tab can pull or push. Homerun mints itself a reserved token at the same
        time, so its own scans and deploys keep working.
      </p>
    </div>
    <form
      action="?/setAuth"
      bind:this={authForm}
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't change the registry's auth.",
        loading: "Reconfiguring the registry",
        success: "Registry auth updated.",
      })}
    >
      <input
        name="enabled"
        type="hidden"
        value={String(!data.status.authEnabled)}
      />
      <CheckBox
        checked={data.status.authEnabled}
        helperText="Applies straight away : the registry container is recreated with its auth file."
        id="registryAuthEnabled"
        label="Require a token"
        name="authEnabled"
        onCheckedChange={() => authForm?.requestSubmit()}
      />
    </form>
  </div>
</section>

<section class="border-border bg-surface-1 rounded-lg border p-4">
  <h2 class="text-text text-sm font-medium">Publish it</h2>
  <p class="text-text-muted mt-1 mb-3 text-sm">
    Routes the registry through Traefik at a hostname of your own, so other
    machines can push to it. Point that hostname's DNS at this host first. Auth
    has to be on : an open registry anyone can push to is never what you want.
  </p>

  {#if !data.status.authEnabled}
    <Alert class="mb-3" title="Turn auth on first.">
      Publishing is refused while the registry accepts anonymous writes.
    </Alert>
  {/if}

  <form
    action="?/setPublicHost"
    class="flex flex-wrap items-center gap-2"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't publish the registry.",
      loading: "Reconfiguring the registry",
      success: "Registry updated.",
    })}
  >
    <Input
      autocomplete="off"
      bind:value={publicHost}
      class="max-w-sm"
      name="publicHost"
      placeholder={data.suggestedHost || "registry.example.com"}
    />
    <Button disabled={!data.status.authEnabled} type="submit">Save</Button>
  </form>

  {#if data.status.publicHost}
    <div class="mt-4">
      <p class="text-text-muted mb-2 text-sm">Push to it with:</p>
      <CopyBox
        value={`docker login ${data.status.publicHost}\ndocker tag myapp:latest ${data.status.publicHost}/myapp:latest\ndocker push ${data.status.publicHost}/myapp:latest`}
      />
    </div>
  {/if}
</section>
