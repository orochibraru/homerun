<script lang="ts">
	import { ExternalLink, KeyRound, LockKeyhole, Plus } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Authentication"));
</script>

<div class="space-y-6 p-6 md:p-8">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-text text-xl font-semibold">Authentication</h1>
      <p class="text-text-muted mt-1 text-sm">
        Who can sign in to Homerun, and which of those methods each protected
        app accepts.
      </p>
    </div>
    <Button href={resolve("/authentication/new")}>
      <Plus class="size-4" />
      Add provider
    </Button>
  </div>

  <!-- ═══ Built-in ═══ -->
  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Built-in authentication</h2>
      <p class="text-text-muted text-xs">
        Homerun's own email and password accounts, managed on the Users page.
      </p>
    </div>
    <div class="space-y-2 p-5 text-sm">
      <p class="text-text-muted">
        Always available for signing in to the dashboard, and selectable per-app
        as the <span class="font-mono text-xs">password</span> method. Accounts
        are created by an admin
        {#if data.smtpEnabled}
          (direct-create or email invite).
        {:else}
          (direct-create : email invites need SMTP configured under Settings →
          Email).
        {/if}
      </p>
      <Button href={resolve("/users")} size="sm" variant="outline">
        Manage users
      </Button>
    </div>
  </section>

  <!-- ═══ Providers ═══ -->
  <section class="glass rounded-2xl">
    <div class="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
      <div>
        <h2 class="eyebrow">OAuth / OIDC providers</h2>
        <p class="text-text-muted text-xs">
          Single sign-on for the dashboard, and selectable per app for the login
          wall.
        </p>
      </div>
      <span class="text-text-subtle shrink-0 font-mono text-xs">
        {data.providers.length} configured
      </span>
    </div>

    {#if data.providers.length === 0}
      <div class="p-5">
        <EmptyState
          icon={KeyRound}
          subtitle="Add one to offer single sign-on alongside email and password."
          title="No providers yet"
        >
          <Button href={resolve("/authentication/new")}>
            <Plus class="size-4" />
            Add provider
          </Button>
        </EmptyState>
      </div>
    {:else}
      <div class="divide-border divide-y">
        {#each data.providers as provider (provider.name)}
          <a
            class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3"
            href="{resolve('/authentication')}/{provider.name}"
          >
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-lg {provider.enabled
              ? 'bg-accent/10 text-accent'
              : 'bg-surface-3 text-text-subtle'}"
            >
              <KeyRound class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2">
                <span class="text-text text-sm font-semibold">{provider.label}</span>
                <span class="text-text-subtle font-mono text-xs">{provider.name}</span>
                {#if !provider.enabled}
                  <span
                    class="border-border text-text-subtle rounded-md border px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wider uppercase"
                  >
                    disabled
                  </span>
                {/if}
              </div>
              <p class="text-text-subtle mt-0.5 truncate font-mono text-xs">
                {provider.discoveryUrl}
              </p>
            </div>
            {#if provider.usedBy > 0}
              <span class="text-text-subtle shrink-0 text-xs">
                {provider.usedBy} app{provider.usedBy === 1 ? "" : "s"}
              </span>
            {/if}
            <ExternalLink class="text-text-subtle size-3.5 shrink-0" />
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ═══ Protected apps ═══ -->
  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Protected apps</h2>
      <p class="text-text-muted text-xs">
        Services with "Require login" turned on. Which methods each one accepts,
        and who's allowed through, is configured on that service's Networking
        tab.
      </p>
    </div>
    {#if data.gatedServices.length === 0}
      <p class="text-text-muted p-5 text-sm">
        No app is behind the login wall yet. Turn on "Require login" on a
        service's Networking tab to add one.
      </p>
    {:else}
      <div class="divide-border divide-y">
        {#each data.gatedServices as svc (svc.id)}
          <a
            class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3"
            href="{resolve('/services')}/{svc.id}/networking"
          >
            <LockKeyhole class="text-accent size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-text truncate text-sm font-medium">{svc.name}</p>
              <p class="text-text-subtle truncate font-mono text-xs">
                {#if svc.methods.length === 0}
                  no sign-in method picked yet : nobody can get in
                {:else}
                  {svc.methods.join(", ")}
                {/if}
              </p>
            </div>
            <ExternalLink class="text-text-subtle size-3.5 shrink-0" />
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>
