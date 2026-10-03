<script lang="ts">
	import { CircleCheck, CircleX } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import Alert from "#lib/components/alert.svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import CopyBox from "#lib/components/copy-box.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { formatBytes } from "#lib/formatting.js";
	import type { RegistryCheck } from "#lib/registry-self-test.js";
	import { testRegistry } from "#lib/remote/registry.remote.js";
	import { enhanceToast, toastError } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data } = $props();

	let publicHost = $state("");
	$effect(() => {
		publicHost = data.status.publicHost ?? "";
	});
	let authForm: HTMLFormElement | undefined = $state();

	let checks = $state<RegistryCheck[] | null>(null);
	let testing = $state(false);

	async function selfTestCallback() {
		testing = true;
		try {
			checks = await testRegistry();
		} finally {
			testing = false;
		}
		const failed = checks.filter((check) => !check.ok).length;
		if (failed > 0) {
			throw new Error(
				failed === 1 ? "1 check failed." : `${failed} checks failed.`,
			);
		}
	}

	function handleSelfTest() {
		return toast.promise(selfTestCallback(), {
			error: (error) => toastError(error, "Couldn't run the self-test."),
			loading: "Testing the registry",
			success: "Every check passed.",
		});
	}
</script>

<section class="border-border bg-surface-1 mb-6 rounded-lg border p-4">
  <div class="flex items-center justify-between gap-4">
    <h2 class="text-text text-sm font-medium">Status</h2>
    <Button
      disabled={testing}
      onclick={handleSelfTest}
      size="sm"
      variant="outline"
    >
      Self-test
    </Button>
  </div>
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
  {#if checks}
    <ul class="border-border mt-4 space-y-2 border-t pt-4">
      {#each checks as check (check.label)}
        <li class="flex items-start gap-2 text-sm">
          {#if check.ok}
            <CircleCheck class="mt-0.5 size-4 shrink-0 text-green-500" />
          {:else}
            <CircleX class="mt-0.5 size-4 shrink-0 text-red-500" />
          {/if}
          <span>
            <span class="text-text font-medium">{check.label}</span>
            <span class="text-text-muted block text-xs">{check.detail}</span>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="border-border bg-surface-1 mb-6 rounded-lg border p-4">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
