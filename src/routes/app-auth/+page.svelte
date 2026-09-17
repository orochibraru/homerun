<script lang="ts">
	import { LockKeyhole, ShieldX } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signOut } from "$lib/auth-client";
	import BrandMark from "$lib/components/brand-mark.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	let loading = $state(false);

	onMount(() => title.set(`Sign in to ${data.appName}`));

	async function switchAccountCallback() {
		loading = true;
		try {
			const { error } = await signOut();
			if (error) {
				throw new Error(error.message ?? "Couldn't sign you out.");
			}
			await invalidateAll();
		} catch (err) {
			loading = false;
			throw err;
		}
	}

	function handleSwitchAccount() {
		return toast.promise(switchAccountCallback(), {
			error: (err) => toastError(err, "Couldn't sign you out."),
			loading: "Signing out",
			success: "Signed out.",
		});
	}
</script>

<div class="flex min-h-screen flex-col items-center justify-center px-6 py-12">
  <div class="w-full max-w-md">
    <div class="panel overflow-hidden rounded-md">
      <div
        class="bg-surface-2 border-border flex items-center gap-3 border-b px-6 py-5"
      >
        <div
          class="bg-accent/10 text-accent flex size-11 shrink-0 items-center justify-center rounded-md"
        >
          {#if data.denial}
            <ShieldX class="size-5" />
          {:else}
            <LockKeyhole class="size-5" />
          {/if}
        </div>
        <div class="min-w-0">
          <p class="eyebrow">Protected app</p>
          <h1 class="text-text mt-0.5 truncate text-lg font-semibold">
            {data.appName}
          </h1>
        </div>
      </div>

      <div class="p-6">
        {#if data.noMethods}
          <p class="text-text-muted text-sm">
            This app is gated, but no sign-in method has been enabled for it
            yet, so nobody can be let through. An admin needs to pick one on the
            service's Security tab.
          </p>
        {:else if data.denial}
          <p class="text-text-muted mb-4 text-sm">{data.denial}</p>
          <p class="text-text-subtle mb-5 text-xs">
            Signed in as {data.signedInAs}
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              disabled={loading}
              onclick={handleSwitchAccount}
              variant="outline"
            >
              Sign in as someone else
            </Button>
            <Button href={resolve("/")} variant="ghost">Back to Homerun</Button>
          </div>
        {/if}
      </div>
    </div>

    <div class="mt-6 flex items-center justify-center gap-2 opacity-60">
      <span class="text-text-subtle text-xs">gated by</span>
      <BrandMark />
    </div>
  </div>
</div>
