<script lang="ts">
	import { KeyRound } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { authClient } from "$lib/auth-client";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { toastError } from "$lib/toast";

	interface Provider {
		accountId: string | null;
		linked: boolean;
		name: string;
	}

	interface Props {
		hasPassword: boolean;
		providers: Provider[];
	}

	const { hasPassword, providers }: Props = $props();

	let linking = $state("");

	async function connectCallback(provider: string) {
		linking = provider;
		try {
			const { error } = await authClient.linkSocial({
				callbackURL: resolve("/profile/security"),
				provider: provider as never,
			});
			if (error) {
				throw new Error(error.message ?? "Couldn't start that connection.");
			}
		} catch (err) {
			linking = "";
			throw err;
		}
	}

	function handleConnect(provider: string) {
		return toast.promise(connectCallback(provider), {
			error: (err) => toastError(err, `Couldn't connect ${provider}.`),
			loading: `Redirecting to ${provider}`,
			success: `Redirecting to ${provider}…`,
		});
	}

	async function disconnectCallback(provider: string, accountId: string) {
		linking = provider;
		try {
			const { error } = await authClient.unlinkAccount({ accountId });
			if (error) {
				throw new Error(error.message ?? "Couldn't disconnect that provider.");
			}
			await invalidateAll();
		} finally {
			linking = "";
		}
	}

	function handleDisconnect(provider: string, accountId: string) {
		return toast.promise(disconnectCallback(provider, accountId), {
			error: (err) => toastError(err, `Couldn't disconnect ${provider}.`),
			loading: `Disconnecting ${provider}`,
			success: `${provider} disconnected.`,
		});
	}
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="Single sign-on providers you can use to reach this dashboard, and any app behind the login wall that accepts them. Connecting one here is what proves the two accounts are yours : signing in through a provider alone can't, so it's refused until you've done this."
    title="Connected accounts"
  />
  <div class="divide-border divide-y">
    {#each providers as provider (provider.name)}
      <div class="flex items-center gap-3 px-5 py-3">
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-lg {provider.linked
            ? 'bg-accent/10 text-accent'
            : 'bg-surface-3 text-text-subtle'}"
        >
          <KeyRound class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-text text-sm font-medium">{provider.name}</p>
          <p class="text-text-subtle text-xs">
            {provider.linked ? "Connected" : "Not connected"}
          </p>
        </div>
        {#if provider.linked}
          <Button
            disabled={linking === provider.name || !hasPassword}
            onclick={() => handleDisconnect(provider.name, provider.accountId ?? "")}
            size="sm"
            variant="outline"
          >
            Disconnect
          </Button>
        {:else}
          <Button
            disabled={linking === provider.name}
            onclick={() => handleConnect(provider.name)}
            size="sm"
            variant="outline"
          >
            Connect
          </Button>
        {/if}
      </div>
    {/each}
  </div>
  {#if !hasPassword}
    <p class="text-text-subtle border-border border-t px-5 py-3 text-xs">
      Set a password above before disconnecting a provider, otherwise you'd
      have no way left to sign in.
    </p>
  {/if}
</section>
