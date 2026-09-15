<script lang="ts">
	import { CircleCheck, KeyRound } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import {
		errorClass,
		inputClass,
		labelClass,
	} from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	onMount(() => title.set("Authorize CLI"));

	let code = $state("");

	$effect(() => {
		code = data.prefilledCode;
	});
</script>

<div class="mx-auto max-w-md p-6 md:p-8">
  <div class="mb-6 flex items-center gap-3">
    <div
      class="bg-accent/10 text-accent flex size-11 shrink-0 items-center justify-center rounded-md"
    >
      <KeyRound class="size-5" />
    </div>
    <div class="min-w-0">
      <p class="eyebrow">Device login</p>
      <h1 class="text-text mt-0.5 text-lg font-semibold tracking-tight">
        Authorize CLI
      </h1>
    </div>
  </div>

  {#if form?.success}
    <div
      class="flex items-start gap-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-500"
    >
      <CircleCheck class="mt-0.5 size-4 shrink-0" />
      <span>
        CLI login approved. You can return to your terminal, it should log you
        in automatically.
      </span>
    </div>
  {:else if form?.denied}
    <div class="rounded-md panel p-4 text-sm text-text-muted">
      Login request denied.
    </div>
  {:else}
    <form action="?/approve" class="panel rounded-md p-5" method="POST" use:enhance>
      <p class="text-text-muted mb-4 text-sm">
        Confirm the code shown by
        <code class="text-xs text-text">homerun login</code> on your
        machine.
      </p>
      <label class={labelClass} for="code">Code</label>
      <input
        autocapitalize="characters"
        autocomplete="off"
        class="{inputClass} tracking-[0.2em] uppercase"
        id="code"
        name="code"
        placeholder="XXXX-XXXX"
        spellcheck="false"
        bind:value={code}
      >
      {#if form?.error}
        <p class={errorClass}>{form.error}</p>
      {/if}

      <div class="mt-5 flex gap-2">
        <Button type="submit">Approve</Button>
        <Button formaction="?/deny" type="submit" variant="outline">Deny</Button>
      </div>
    </form>
  {/if}
</div>
