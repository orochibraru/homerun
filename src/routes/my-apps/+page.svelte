<script lang="ts">
	import {
		AppWindow,
		ExternalLink,
		Fingerprint,
		LogOut,
		Smartphone,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { refreshAll } from "$app/navigation";
	import { signOut } from "$lib/auth-client";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import PasskeyPanel from "$lib/components/passkey-panel.svelte";
	import TwoFactorPanel from "$lib/components/two-factor-panel.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set("Your apps"));

	async function signOutCallback() {
		const { error } = await signOut();
		if (error) {
			throw new Error(error.message ?? "Couldn't sign you out.");
		}
		await refreshAll();
	}

	function handleSignOut() {
		return toast.promise(signOutCallback(), {
			error: (err) => toastError(err, "Couldn't sign you out."),
			loading: "Signing you out",
			success: "Signed out.",
		});
	}
</script>

<AuthShell
  eyebrow="Signed in"
  heading="Your apps"
  subheading="You're signed in. Your account can only open the apps shared with you:"
>
  <div class="space-y-6">
    <p class="text-text-muted text-xs">
      Signed in as <span class="text-text font-medium">{data.email}</span>
    </p>

    {#if data.apps.length === 0}
      <p class="text-text-muted text-sm">
        Nothing is shared with you yet. Ask whoever runs this Homerun to let
        you through an app's login wall.
      </p>
    {:else}
      <ul class="space-y-2">
        {#each data.apps as app (app.id)}
          <li>
            <a
              class="border-border hover:bg-surface-2 flex items-center gap-3 rounded-md border px-3 py-2.5"
              href={app.url}
            >
              <AppWindow class="text-text-muted size-4 shrink-0" />
              <span class="min-w-0 flex-1">
                <span class="text-text block truncate text-sm font-medium">
                  {app.name}
                </span>
                {#if app.canary}
                  <span class="text-text-muted block truncate text-xs">
                    Canary of the next release
                  </span>
                {:else if app.pullRequest}
                  <span class="text-text-muted block truncate text-xs">
                    Preview of PR #{app.pullRequest.number}{app.pullRequest
                      .title
                      ? `: ${app.pullRequest.title}`
                      : ""}
                  </span>
                {:else}
                  <span class="text-text-muted block truncate text-xs">
                    {app.url.replace("https://", "")}
                  </span>
                {/if}
              </span>
              <ExternalLink class="text-text-muted size-4 shrink-0" />
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    <section class="border-border space-y-3 border-t pt-5">
      <h2 class="text-text flex items-center gap-2 text-sm font-semibold">
        <Smartphone class="size-4" />
        Two-factor authentication
      </h2>
      <TwoFactorPanel
        enabled={data.twoFactorEnabled}
        hasPassword={data.hasPassword}
      />
    </section>

    <section class="space-y-3">
      <h2 class="text-text flex items-center gap-2 text-sm font-semibold">
        <Fingerprint class="size-4" />
        Passkeys
      </h2>
      <PasskeyPanel passkeys={data.passkeys} />
    </section>
  </div>

  {#snippet footer()}
    <Button onclick={handleSignOut} size="sm" variant="ghost">
      <LogOut class="size-4" />
      Sign out
    </Button>
  {/snippet}
</AuthShell>
