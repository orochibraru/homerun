<script lang="ts">
	import { KeyRound, Plus, Trash2 } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";

	const { data } = $props();

	interface OauthRow {
		clientId: string;
		clientSecret: string;
		discoveryUrl: string;
		enabled: boolean;
		hasSecret: boolean;
		name: string;
		pkce: boolean;
		scopes: string;
	}

	function toRow(p: (typeof data.settings.oauthProviders)[number]): OauthRow {
		return {
			clientId: p.clientId,
			clientSecret: "",
			discoveryUrl: p.discoveryUrl,
			enabled: p.enabled,
			hasSecret: !!p.clientSecretEnc,
			name: p.name,
			pkce: p.pkce,
			scopes: p.scopes.join(", "),
		};
	}

	let oauthRows = $state<OauthRow[]>(
		untrack(() => data.settings.oauthProviders.map(toRow)),
	);
	$effect(() => {
		oauthRows = data.settings.oauthProviders.map(toRow);
	});

	function addOauthRow() {
		oauthRows.push({
			clientId: "",
			clientSecret: "",
			discoveryUrl: "",
			enabled: true,
			hasSecret: false,
			name: "",
			pkce: true,
			scopes: "",
		});
	}

	function removeOauthRow(i: number) {
		oauthRows.splice(i, 1);
	}

	function submitToast(sectionLabel: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === "success") {
					toast.success(`${sectionLabel} saved.`);
				} else if (result.type === "failure") {
					toast.error(
						(result.data as { error?: string } | undefined)?.error ??
							"Check the form for errors.",
					);
				}
				await update();
			};
	}
</script>

<section class="border-border bg-surface rounded-2xl border">
  <div class="border-border border-b px-5 py-4">
    <h2 class="text-text text-sm font-semibold">OAuth Providers</h2>
    <p class="text-text-muted text-xs">
      Any generic OIDC provider : used both for signing into Homerun itself
      and for gating a service with "Require login" (Networking tab). Saving
      here rebuilds the auth backend live, no restart needed.
    </p>
  </div>
  <form
    action="?/updateOauth"
    class="space-y-4 p-5"
    method="POST"
    use:enhance={submitToast("OAuth providers")}
  >
    {#each oauthRows as row, i (i)}
      <div class="border-border space-y-3 rounded-xl border p-4">
        <div class="flex items-center justify-between">
          <div class="text-text-muted flex items-center gap-2">
            <KeyRound class="size-4" />
            <span
              class="text-xs font-medium tracking-wide uppercase"
            >Provider {i + 1}</span>
          </div>
          <Button
            aria-label="Remove provider"
            class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
            onclick={() => removeOauthRow(i)}
            size="icon-sm"
            variant="ghost"
          >
            <Trash2 class="size-4" />
          </Button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class={label} for="oauthName-{i}">Provider id</label>
            <Input
              class="font-mono"
              id="oauthName-{i}"
              name="oauthName"
              placeholder="my-oidc-provider"
              type="text"
              bind:value={row.name}
            />
          </div>
          <div>
            <label class={label} for="oauthClientId-{i}">Client id</label>
            <Input
              id="oauthClientId-{i}"
              name="oauthClientId"
              type="text"
              bind:value={row.clientId}
            />
          </div>
          <div>
            <label class={label} for="oauthClientSecret-{i}"
            >Client secret</label>
            <Input
              id="oauthClientSecret-{i}"
              name="oauthClientSecret"
              placeholder={row.hasSecret
              ? "Leave blank to keep current"
              : "Client secret"}
              type="password"
              bind:value={row.clientSecret}
            />
          </div>
          <div>
            <label class={label} for="oauthDiscoveryUrl-{i}"
            >Discovery URL</label>
            <Input
              class="font-mono"
              id="oauthDiscoveryUrl-{i}"
              name="oauthDiscoveryUrl"
              placeholder="https://provider.example.com/.well-known/openid-configuration"
              type="text"
              bind:value={row.discoveryUrl}
            />
          </div>
          <div class="sm:col-span-2">
            <label class={label} for="oauthScopes-{i}"
            >Scopes (comma-separated)</label>
            <Input
              class="font-mono"
              id="oauthScopes-{i}"
              name="oauthScopes"
              placeholder="openid, email, profile"
              type="text"
              bind:value={row.scopes}
            />
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <CheckBox
            helperText="Allow signing in with this provider"
            id="oauthEnabledToggle-{i}"
            label="Enabled"
            name="oauthEnabledToggle-{i}"
            bind:checked={row.enabled}
          />
          <CheckBox
            helperText="Use PKCE for the OAuth code exchange"
            id="oauthPkceToggle-{i}"
            label="PKCE"
            name="oauthPkceToggle-{i}"
            bind:checked={row.pkce}
          />
        </div>
        <input
          name="oauthEnabled"
          type="hidden"
          value={row.enabled ? "true" : "false"}
        >
        <input
          name="oauthPkce"
          type="hidden"
          value={row.pkce ? "true" : "false"}
        >
      </div>
    {/each}

    <Button class="h-auto p-0" onclick={addOauthRow} variant="link">
      <Plus class="size-3.5" />
      Add provider
    </Button>

    <div class="flex justify-end">
      <Button type="submit">Save</Button>
    </div>
  </form>
</section>
