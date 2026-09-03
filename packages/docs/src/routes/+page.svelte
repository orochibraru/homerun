<script lang="ts">
	import SiteFooter from "$lib/site-footer.svelte";
	import SiteHeader from "$lib/site-header.svelte";

	const oneLiner =
		"curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/installer/bootstrap.sh \\\n  | sudo bash -s -- --mode=full";

	const features: Array<{ title: string; body: string }> = [
		{
			body: "Point at a Docker image and tag, or a git URL Homerun clones and builds from its Dockerfile. No registry required either way.",
			title: "Deploy an image or a git repo",
		},
		{
			body: "Every service gets a real subdomain and a Let's Encrypt certificate automatically, no manual Traefik labels to hand-write.",
			title: "Traefik routing, TLS included",
		},
		{
			body: "Group services on a project network so they can reach each other by name, and one-click templates for the stacks you deploy often.",
			title: "Projects & shared networks",
		},
		{
			body: "Bind-mount or Docker-managed volumes, mounted into one or more services, with optional scheduled backups to any S3-compatible bucket.",
			title: "Volumes & S3-compatible backups",
		},
		{
			body: "Deploy to a second machine over a raw Docker connection or a token-authenticated agent, including migrate-on-load-threshold autoscaling.",
			title: "Remote hosts & the Homerun Agent",
		},
		{
			body: "A real OpenAPI 3.1 spec generated from the same schemas that validate every request, plus a typed CLI built against it.",
			title: "REST API & CLI",
		},
	];
</script>

<svelte:head>
    <title>Homerun — a self-hosted PaaS for your own server</title>
</svelte:head>

<SiteHeader current="home" />

<main>
    <!-- ── Hero ─────────────────────────────────────────────────────── -->
    <section
        class="relative overflow-hidden px-6 pt-24 pb-20 text-center sm:pt-32 sm:pb-28"
    >
        <div
            class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-140 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,var(--accent-soft),transparent)]"
        ></div>

        <p
            class="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-(--border) px-3.5 py-1 text-xs font-medium text-(--text-muted)"
        >
            <span class="size-1.5 rounded-full bg-(--accent)"></span>
            Self-hosted · single binary stack · your own hardware
        </p>

        <h1
            class="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl"
        >
            Deploy containers to
            <span
                class="bg-linear-to-r from-(--accent-strong) to-[#c8b8ff] bg-clip-text text-transparent"
                >your own server</span
            >, not someone else's cloud.
        </h1>

        <p
            class="mx-auto mt-6 max-w-xl text-lg text-(--text-muted) text-balance"
        >
            Point Homerun at a Docker image or a git repo, fill in a
            click-config form, deploy. Traefik routes it to a real subdomain
            with TLS — a minimal Cloud Run / Dokploy alternative you run
            yourself.
        </p>

        <div
            class="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
            <a
                href="/docs/getting-started"
                class="rounded-full bg-(--accent) px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--accent-strong)"
                >Get started</a
            >
            <a
                href="https://github.com/orochibraru/homerun"
                target="_blank"
                rel="noreferrer"
                class="rounded-full border border-(--border) px-6 py-2.5 text-sm font-semibold transition-colors hover:border-(--border-hover)"
                >View source</a
            >
        </div>

        <div class="mx-auto mt-14 max-w-2xl text-left">
            <div
                class="flex items-center gap-2 rounded-t-lg border border-b-0 border-(--border) bg-(--bg-raised) px-4 py-2.5"
            >
                <span class="size-2.5 rounded-full bg-[#ff5f57]"></span>
                <span class="size-2.5 rounded-full bg-[#febc2e]"></span>
                <span class="size-2.5 rounded-full bg-[#28c840]"></span>
                <span class="ml-2 text-xs text-(--text-subtle)"
                    >fresh Linux server</span
                >
            </div>
            <pre
                class="overflow-x-auto rounded-b-lg border border-(--border) bg-(--code-bg) px-4 py-4 text-left text-[13px] leading-relaxed"><code
                    class="text-(--text-muted)">{oneLiner}</code
                ></pre>
        </div>
    </section>

    <!-- ── Features ─────────────────────────────────────────────────── -->
    <section id="features" class="mx-auto max-w-6xl px-6 pb-24">
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {#each features as feature (feature.title)}
                <div
                    class="rounded-2xl border border-(--border) bg-(--bg-card) p-6 transition-colors hover:border-(--border-hover)"
                >
                    <h3 class="mb-2 text-[15px] font-semibold">
                        {feature.title}
                    </h3>
                    <p class="text-sm leading-relaxed text-(--text-muted)">
                        {feature.body}
                    </p>
                </div>
            {/each}
        </div>
    </section>

    <!-- ── Stack strip ──────────────────────────────────────────────── -->
    <section
        class="border-y border-(--border) bg-(--bg-raised) px-6 py-14"
    >
        <div class="mx-auto max-w-4xl text-center">
            <h2 class="text-2xl font-bold tracking-tight">
                One host. No orchestration to learn.
            </h2>
            <p class="mx-auto mt-3 max-w-xl text-(--text-muted)">
                SvelteKit + Bun, better-auth, Drizzle over Postgres, and the
                Docker socket you already have. Rootless by default when
                installed via the one-liner above.
            </p>
            <div
                class="mx-auto mt-8 flex max-w-lg flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-(--text-subtle)"
            >
                <span>SvelteKit 5</span>
                <span>Bun</span>
                <span>Postgres</span>
                <span>Traefik</span>
                <span>Docker</span>
            </div>
        </div>
    </section>

    <!-- ── CTA ──────────────────────────────────────────────────────── -->
    <section class="px-6 py-20 text-center">
        <h2 class="text-2xl font-bold tracking-tight">
            Read the docs, then deploy your first service.
        </h2>
        <p class="mx-auto mt-3 max-w-md text-(--text-muted)">
            Nine guides cover install, configuration, services, storage, remote
            hosts, users, the API, and the FAQ.
        </p>
        <a
            href="/docs/getting-started"
            class="mt-8 inline-block rounded-full bg-(--accent) px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--accent-strong)"
            >Open the docs →</a
        >
    </section>
</main>

<SiteFooter />
