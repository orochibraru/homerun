<script lang="ts">
	import { onMount } from "svelte";
	import { dev } from "$app/environment";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { Button } from "$lib/components/ui/button";
	import { title } from "$lib/store/title";
	import { cn } from "$lib/utils";

	interface Props {
		normalHeight: boolean;
	}

	const { normalHeight = false }: Props = $props();

	onMount(() => {
		$title = "Error";
	});
</script>

<div
  class={cn(
    "flex flex-col items-center justify-center gap-2 p-5",
    normalHeight ? "h-full" : "h-screen",
  )}
>
  <div class="flex flex-col gap-5 p-5 text-center">
    <h1 class="text-center text-[5rem] font-bold text-gray-700">
      {page.status ?? 500}
    </h1>

    {#if page.status === 404}
      <p class="text-2xl text-gray-800">Not found</p>
      {#if dev}
        <p class="text-lg">{page.error?.message}</p>
      {:else}
        <p class="text-lg">
          This page could not be found. It may have been deleted or moved.
        </p>
      {/if}
    {:else if page.status >= 401 && page.status <= 403}
      <p class="text-2xl text-gray-800">You don't have access to this page.</p>
      <p class="text-lg">Unauthorized</p>
    {:else}
      <p class="text-2xl text-gray-800">Oops</p>
      {#if page.status === 403 || page.status === 401}
        <p class="max-w-3xl overflow-x-auto text-lg">
          You don't have access to this page. Contact your administrator.
        </p>
      {:else}
        <p class="text-lg">
          {page.error?.message}
        </p>
      {/if}
    {/if}

    {#if page.error?.errorId && page.status === 500}
      <p class="text-muted-foreground max-w-175 text-center text-lg">
        Error ID: {page.error.errorId}
      </p>
    {/if}
  </div>

  <Button href={resolve("/")}>Go home</Button>
</div>
