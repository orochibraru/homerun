<script lang="ts">
  import type { Component, Snippet } from "svelte";

  const {
    icon: Icon,
    title,
    subtitle,
    children,
  }: {
    icon: Component<{ class?: string }>;
    title: string;
    subtitle?: string;
    children?: Snippet;
  } = $props();
</script>

<div
  class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center"
>
  <Icon class="mb-3 size-10 text-text-muted opacity-40" />
  <p class="text-sm font-medium text-text-muted">{title}</p>
  {#if subtitle}
    <p class="mt-1 text-xs text-text-subtle">{subtitle}</p>
  {/if}
  {#if children}
    <div class="mt-5">
      {@render children()}
    </div>
  {/if}
</div>
