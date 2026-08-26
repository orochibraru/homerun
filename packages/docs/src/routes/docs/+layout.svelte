<script lang="ts">
	import { page } from "$app/state";
	import { docPages } from "$lib/docs-content";
	import SiteFooter from "$lib/site-footer.svelte";
	import SiteHeader from "$lib/site-header.svelte";

	const { children } = $props();
</script>

<SiteHeader current="docs" />

<div class="mx-auto flex items-start gap-10 px-6 py-12">
    <!-- ── Sidebar ──────────────────────────────────────────────────── -->
    <aside class="sticky top-20 hidden w-56 shrink-0 lg:block">
        <nav class="flex flex-col gap-1 text-sm">
            {#each docPages as doc (doc.slug)}
                <a
                    href="/docs/{doc.slug}"
                    class="rounded-lg px-3 py-1.5 transition-colors {page.url
                        .pathname === `/docs/${doc.slug}`
                        ? 'bg-(--accent-soft) font-medium text-(--accent-strong)'
                        : 'text-(--text-muted) hover:bg-(--bg-card) hover:text-(--text)'}"
                    >{doc.title}</a
                >
            {/each}
            <div class="my-2 border-t border-(--border)"></div>
            <a
                href="/docs/api"
                class="rounded-lg px-3 py-1.5 transition-colors {page.url
                    .pathname === '/docs/api'
                    ? 'bg-(--accent-soft) font-medium text-(--accent-strong)'
                    : 'text-(--text-muted) hover:bg-(--bg-card) hover:text-(--text)'}"
                >API reference</a
            >
        </nav>
    </aside>

    <div class="min-w-0 flex-1">
        {@render children()}
    </div>
</div>

<SiteFooter />
