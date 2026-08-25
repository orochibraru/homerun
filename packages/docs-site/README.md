# Homerun docs site

A standalone, fully static SvelteKit site (own `svelte.config.js`/
`vite.config.ts`/`tsconfig.json` here, `@sveltejs/adapter-static` build, sharing
the root `package.json`/`bun install` the same way `packages/agent`/
`cli`/`installer` do rather than getting its own): the landing page, plus a
`/docs/<slug>` guide for every file under the repo root's `docs/*.md`.

## Why this exists

`docs/README.md` itself used to say "no generated site yet" — this is that site.
It's a companion to, not a replacement for, `docs/`: those files stay the source
of truth (plain Markdown, readable straight from the repo or a Gitea/GitHub file
browser with zero setup); this site renders the exact same files through
`src/lib/docs-content.ts`'s `import.meta.glob` at build time, so there's never a
second, separately-maintained copy to let drift.

## Commands

```bash
bun run dev:docs-site      # vite dev, from the repo root
bun run build:docs-site    # vite build -> packages/docs-site/build/
bun run check:docs-site    # svelte-check, also part of the root `bun run check`
```

Or from inside `packages/docs-site/` directly: `bunx vite dev` /
`bunx vite build` /
`bunx svelte-check --tsconfig ./tsconfig.json --fail-on-warnings`.

## How guide pages are built

- `src/lib/docs-content.ts` globs `../../../../docs/*.md` (eager, `?raw`),
  extracts each page's `# Title` (first `#` heading) and slug (filename minus
  `.md`), and parses the body with `marked` through a custom renderer that:
  - Adds GitHub-matching `id`s to every heading (marked doesn't do this on its
    own), so an in-repo `#some-heading` anchor link still resolves here.
  - Rewrites relative links: another guide (`slug.md`, optionally `#hash`)
    becomes `/docs/slug`; anything else relative (`../TODO.md`,
    `../compose.prod.yaml`, `installer/README.md`, …) becomes a link to that
    file in the repo's own Gitea browser instead, since this site doesn't
    publish every file in the repo, only the guides.
- `docs/README.md`'s own numbered guide list is the reading order mirrored into
  `ORDER` (and the sidebar nav) — not alphabetical.
- `src/routes/docs/[slug]/+page.ts`'s `entries()` enumerates every known slug so
  the static adapter prerenders each one; nothing here is resolved at request
  time (there is no request time — see below).

## Deploying it

The build output (`packages/docs-site/build/`) is plain static files, no
Bun/Node runtime required — host it anywhere static files can go (the main app's
own release pipeline doesn't currently publish this anywhere, wiring that up is
a separate step, see the repo root's `TODO.md`).
