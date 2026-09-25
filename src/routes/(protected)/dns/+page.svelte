<script lang="ts">
	import { Globe } from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import CloudflareSection from "./cloudflare-section.svelte";
	import PangolinSection from "./pangolin-section.svelte";

	const { data } = $props();

	onMount(() => title.set("DNS"));

	type Provider = "" | "cloudflare" | "pangolin";

	const PROVIDERS: { detail: string; label: string; value: Provider }[] = [
		{
			detail: "Add DNS records for your services yourself.",
			label: "None",
			value: "",
		},
		{
			detail:
				"Creates a DNS record in your Cloudflare zone for every routed service.",
			label: "Cloudflare",
			value: "cloudflare",
		},
		{
			detail:
				"Publishes every routed service through a self-hosted Pangolin tunnel.",
			label: "Pangolin",
			value: "pangolin",
		},
	];

	const current = $derived<Provider>(data.provider ?? "");
	let pending = $state<Provider>("");
	let confirmOpen = $state(false);
	let providerForm = $state<HTMLFormElement | null>(null);

	function choose(value: Provider) {
		if (value === current) {
			return;
		}
		pending = value;
		if (current === "") {
			void tick().then(() => providerForm?.requestSubmit());
			return;
		}
		confirmOpen = true;
	}

	const baseDomain = $derived(
		data.settings.baseDomain ?? data.envDefaults.baseDomain,
	);
</script>

<div class="p-5 md:p-6">
  <div class="mb-6">
    <h1 class="text-text text-lg font-semibold tracking-tight">DNS</h1>
    <p class="text-text-muted mt-1 text-sm">
      Let Homerun publish your services' hostnames through one DNS provider.
      Only one is ever active : two providers writing records for the same
      hostnames would fight each other.
    </p>
  </div>

  <form
    action="?/setProvider"
    class="hidden"
    method="POST"
    bind:this={providerForm}
    use:enhance={enhanceToast({
      error: "Couldn't change the DNS provider.",
      loading: "Changing the DNS provider",
      success: "DNS provider changed.",
    })}
  >
    <input name="provider" type="hidden" value={pending}>
  </form>

  <div class="mb-6 grid gap-3 sm:grid-cols-3">
    {#each PROVIDERS as provider (provider.value)}
      <button
        class="flex flex-col gap-1 rounded-md border p-4 text-left transition-colors {current ===
        provider.value
          ? 'border-accent bg-accent-light'
          : 'border-border hover:bg-surface-2'}"
        aria-pressed={current === provider.value}
        onclick={() => choose(provider.value)}
        type="button"
      >
        <span class="text-text text-sm font-medium">{provider.label}</span>
        <span class="text-text-muted text-xs">{provider.detail}</span>
      </button>
    {/each}
  </div>

  {#if current}
    <section class="panel mb-6 rounded-md">
      <div class="border-border border-b px-5 py-4">
        <h2 class="eyebrow">Domains</h2>
        <p class="text-text-muted text-xs">
          {current === "cloudflare"
            ? "The zones your Cloudflare token can see."
            : "The domains registered to your Pangolin org."}
          A service's domain has to sit under one of these for Homerun to
          publish it.
        </p>
      </div>
      <div class="p-5">
        {#await data.domains}
          <Skeleton class="h-6 w-64" />
        {:then result}
          {#if result.error}
            <p class="text-text-muted text-sm">{result.error}</p>
          {:else if result.domains.length === 0}
            <p class="text-text-muted text-sm">No domains found.</p>
          {:else}
            <ul class="flex flex-wrap gap-2">
              {#each result.domains as domain (domain)}
                <li class="border-border flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs">
                  <Globe class="text-accent size-3.5" />
                  {domain}
                </li>
              {/each}
            </ul>
          {/if}
        {/await}
      </div>
    </section>
  {/if}

  {#if current === "cloudflare"}
    <CloudflareSection {baseDomain} settings={data.settings} />
  {:else if current === "pangolin"}
    <PangolinSection settings={data.settings} />
  {/if}
</div>

<ConfirmDialog
  confirmLabel="Switch"
  description={`Homerun stops managing ${current === "cloudflare" ? "Cloudflare records" : "Pangolin resources"} and ${pending ? `starts using ${pending === "cloudflare" ? "Cloudflare" : "Pangolin"}` : "publishes nothing itself"}. Existing records and resources are left as they are, and the other provider's settings stay saved.`}
  onConfirm={() => providerForm?.requestSubmit()}
  title="Change the DNS provider?"
  bind:open={confirmOpen}
/>
