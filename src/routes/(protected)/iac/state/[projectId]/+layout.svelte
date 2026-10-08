<script lang="ts">
	import { ArrowLeft, FileCode2, KeyRound, Settings } from "@lucide/svelte";
	import { onMount } from "svelte";
	import Alert from "#lib/components/alert.svelte";
	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";

	const { children, data } = $props();

	onMount(() => title.set(`Infrastructure as Code · ${data.project.name}`));

	const sections = $derived([
		{
			href: resolve("/(protected)/iac/state/[projectId]", {
				projectId: data.project.id,
			}),
			icon: FileCode2,
			label: "State",
		},
		{
			href: resolve("/(protected)/iac/state/[projectId]/access", {
				projectId: data.project.id,
			}),
			icon: KeyRound,
			label: "Access keys",
		},
		{
			href: resolve("/(protected)/iac/state/[projectId]/settings", {
				projectId: data.project.id,
			}),
			icon: Settings,
			label: "Settings",
		},
	]);
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/iac/state")}
  >
    <ArrowLeft class="size-4" />
    All state backends
  </a>

  <div>
    <h2 class="text-text text-base font-semibold">{data.project.name}</h2>
    <p class="text-text-muted mt-0.5 text-xs">
      Kept in <span class="font-mono">{data.project.bucket}{data.project.prefix ? `/${data.project.prefix}` : ""}</span>{data.store ? ` on ${data.store.name}` : ""}.
    </p>
  </div>

  {#if data.bucket.problem}
    <Alert variant="warning">{data.bucket.problem}</Alert>
  {/if}

  <div>
    <SectionNav label="State backend sections" {sections} />
    <ErrorBoundary title="This section hit an error while rendering.">
      {@render children()}
    </ErrorBoundary>
  </div>
</div>
