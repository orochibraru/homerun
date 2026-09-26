<script lang="ts">
	import { CornerDownRight, Server } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import { resolve } from "$app/paths";
	import ServiceTree from "$lib/components/service-tree.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import type { DependencyNode, GraphServiceInfo } from "$lib/service-graph";
	import type { ContainerStatus } from "$lib/types";

	interface Props {
		/** Stacks shown on this page: a dependency in any other one is marked as outside. Unset, nothing is. */
		localStackIds?: Set<string>;
		nodes: DependencyNode[];
		services: Map<string, GraphServiceInfo>;
		stackNames: Map<string, string>;
		/** Wraps each row, for the service context menu. */
		wrapper?: Snippet<[GraphServiceInfo, Snippet]>;
	}

	const { localStackIds, nodes, services, stackNames, wrapper }: Props =
		$props();
</script>

<ul class="space-y-1">
  {#each nodes as node, i (`${node.id}-${i}`)}
    {@const svc = services.get(node.id)}
    {#if svc}
      <li>
        {#snippet row()}
          {@const outside =
            localStackIds !== undefined &&
            !(svc.stackId && localStackIds.has(svc.stackId))}
          <a
            class="border-border hover:bg-surface-2 flex flex-col gap-2 rounded-md border px-3 py-2 transition-colors sm:flex-row sm:items-center sm:gap-3 {outside ||
            node.repeat
              ? 'border-dashed opacity-80'
              : ''}"
            href={`${resolve("/services")}/${svc.id}`}
          >
            <span class="flex min-w-0 flex-1 items-center gap-3">
              <TemplateIcon
                category={svc.category}
                class="size-7 shrink-0 rounded-md"
                fallback={Server}
                icon={svc.icon}
              />
              <span class="min-w-0 flex-1">
                <span class="text-text block text-sm font-medium wrap-break-word sm:truncate">
                  {svc.name}
                </span>
                <span class="text-text-subtle block font-mono text-[0.6875rem] break-all sm:truncate sm:break-normal">
                  {svc.slug}<span class="hidden sm:inline"> · {svc.image}</span>
                </span>
              </span>
            </span>
            <span class="flex shrink-0 flex-wrap items-center gap-2 pl-10 sm:pl-0">
              {#if outside}
                <span class="text-text-muted text-[0.6875rem]">
                  {svc.stackId
                    ? `in ${stackNames.get(svc.stackId) ?? "another stack"}`
                    : "no stack"}
                </span>
              {/if}
              {#if node.repeat}
                <span class="text-text-subtle text-[0.6875rem]">shown above</span>
              {/if}
              <StatusBadge status={svc.currentStatus as ContainerStatus} />
            </span>
          </a>
        {/snippet}
        {#if wrapper}
          {@render wrapper(svc, row)}
        {:else}
          {@render row()}
        {/if}
        {#if node.children.length > 0}
          <div class="border-border mt-1 ml-2 flex gap-1 border-l pl-1.5 sm:ml-5 sm:pl-2">
            <CornerDownRight class="text-text-subtle mt-2.5 hidden size-3.5 shrink-0 sm:block" />
            <div class="min-w-0 flex-1">
              <ServiceTree
                {localStackIds}
                nodes={node.children}
                {services}
                {stackNames}
                {wrapper}
              />
            </div>
          </div>
        {/if}
      </li>
    {/if}
  {/each}
</ul>
