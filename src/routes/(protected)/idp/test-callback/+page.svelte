<script lang="ts">
	import { ArrowLeft, CircleCheck, CircleX } from "@lucide/svelte";
	import { onMount } from "svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";

	const { data } = $props();
	const result = $derived(data.result);
	const passed = $derived(
		result.steps.length > 0 && result.steps.every((step) => step.ok),
	);

	onMount(() => title.set("Test sign-in"));
</script>

<div class="space-y-6 p-5 md:p-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-text text-xl font-semibold">
        Test sign-in{result.appName ? ` for ${result.appName}` : ""}
      </h1>
      <p class="text-text-muted mt-1 text-sm">
        {passed
          ? "Everything worked: this is what the app receives when you sign in."
          : "The flow stopped at the step marked below."}
      </p>
    </div>
    {#if result.appId}
      <Button href={resolve("/(protected)/idp/[appId]", { appId: result.appId })} variant="outline">
        <ArrowLeft class="size-4" />
        Back to the app
      </Button>
    {/if}
  </div>

  <section class="panel rounded-md">
    <ol class="divide-border divide-y">
      {#each result.steps as step (step.label)}
        <li class="flex items-start gap-3 px-5 py-3">
          {#if step.ok}
            <CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-500" />
          {:else}
            <CircleX class="mt-0.5 size-4 shrink-0 text-red-500" />
          {/if}
          <div class="min-w-0">
            <p class="text-text text-sm font-medium">{step.label}</p>
            <p class="text-text-muted text-xs wrap-break-word">{step.detail}</p>
          </div>
        </li>
      {/each}
    </ol>
  </section>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
    {#if result.idTokenClaims}
      <section class="panel rounded-md">
        <PanelHeader description="The claims in the ID token the app would get." title="ID token" />
        <pre class="log-output overflow-x-auto rounded-b-md">{JSON.stringify(result.idTokenClaims, null, 2)}</pre>
      </section>
    {/if}
    {#if result.userinfo}
      <section class="panel rounded-md">
        <PanelHeader description="What the userinfo endpoint answers with the access token." title="Userinfo" />
        <pre class="log-output overflow-x-auto rounded-b-md">{JSON.stringify(result.userinfo, null, 2)}</pre>
      </section>
    {/if}
  </div>
</div>
