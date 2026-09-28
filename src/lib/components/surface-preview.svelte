<script lang="ts">
	interface Props {
		surface: string;
	}

	const { surface }: Props = $props();
</script>

<span
  class="bg-bg block w-full rounded-md p-3"
  data-surface={surface}
  style="background-image: var(--page-bg-image, none)"
>
  <span class="panel block overflow-hidden rounded-md">
    <span class="flex items-center px-3 py-1.5" data-slot="panel-header">
      <span class="text-text text-[0.625rem] font-semibold">Homerun</span>
    </span>
    <span class="flex items-center justify-between gap-2 p-3">
      <span class="bg-text-subtle/40 h-2 w-12 rounded-full"></span>
      <span
        class="bg-ink text-ink-foreground rounded-md border border-transparent px-2 py-1 text-[0.625rem]"
        data-slot="button"
        data-variant="default"
      >
        Deploy
      </span>
    </span>
  </span>
</span>
