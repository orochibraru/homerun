<script lang="ts">
	import { KeyRound } from "@lucide/svelte";
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
    <div class="rounded-xl bg-surface p-2.5">
      <KeyRound class="text-text-muted size-5" />
    </div>
    <div>
      <h1 class="text-text text-xl font-bold">Authorize CLI</h1>
      <p class="text-text-muted text-sm">
        Confirm the code shown by <code>homerun login</code> on your machine.
      </p>
    </div>
  </div>

  {#if form?.success}
    <div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-500">
      CLI login approved. You can return to your terminal, it should log you in
      automatically.
    </div>
  {:else if form?.denied}
    <div class="rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">
      Login request denied.
    </div>
  {:else}
    <form method="POST" action="?/approve" use:enhance>
      <label class={labelClass} for="code">Code</label>
      <input
        id="code"
        name="code"
        class={inputClass}
        placeholder="XXXX-XXXX"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        bind:value={code}
      />
      {#if form?.error}
        <p class={errorClass}>{form.error}</p>
      {/if}

      <div class="mt-4 flex gap-2">
        <Button type="submit">Approve</Button>
        <Button type="submit" formaction="?/deny" variant="outline">Deny</Button>
      </div>
    </form>
  {/if}
</div>
