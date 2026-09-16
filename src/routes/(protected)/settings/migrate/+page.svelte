<script lang="ts">
	import { ArrowRight } from "@lucide/svelte";
	import { resolve } from "$app/paths";

	const sources = [
		{
			description:
				"Applications (Docker image or Dockerfile from git), raw compose stacks and databases, with their env, domains' ports and volume mounts.",
			href: resolve("/settings/migrate/dokploy"),
			label: "Dokploy",
		},
		{
			description:
				"Applications (Docker image, Dockerfile or compose from git), one-click services and databases, with their env and ports.",
			href: resolve("/settings/migrate/coolify"),
			label: "Coolify",
		},
	];
</script>

<section class="panel rounded-md">
  <div class="border-border border-b px-5 py-4">
    <h2 class="eyebrow">Migrate</h2>
    <p class="text-text-muted text-xs">
      Pull the projects from another PaaS into this instance. Read-only on the
      other side, and nothing imported is deployed until you deploy it.
    </p>
  </div>
  <div class="grid gap-4 p-5 sm:grid-cols-2">
    {#each sources as source (source.href)}
      <a
        class="border-border hover:bg-surface-2 group flex flex-col gap-1.5 rounded-md border p-4 transition-colors"
        href={source.href}
      >
        <span class="text-text flex items-center justify-between text-sm font-medium">
          {source.label}
          <ArrowRight class="text-text-muted size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
        <span class="text-text-muted text-xs">{source.description}</span>
      </a>
    {/each}
  </div>
</section>
