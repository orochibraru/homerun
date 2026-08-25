# Homerun docs site

A standalone, fully static SvelteKit site (own `svelte.config.js`/
`vite.config.ts`/`tsconfig.json` here, `@sveltejs/adapter-static` build, sharing
the root `package.json`/`bun install` the same way `packages/agent`/
`cli`/`installer` do rather than getting its own): the landing page, an
`/docs/<slug>` guide for every file under the repo root's `docs/*.md`, and a
`/docs/api` Swagger UI page for the REST API's OpenAPI spec.

## Why this exists

`docs/README.md` itself used to say "no generated site yet" — this is that site.
It's a companion to, not a replacement for, `docs/`: those files stay the source
of truth (plain Markdown, readable straight from the repo or a Gitea/GitHub file
browser with zero setup); this site renders the exact same files through
`src/lib/docs-content.ts`'s `import.meta.glob` at build time, so there's never a
second, separately-maintained copy to let drift.

## Commands

```bash
bun run dev:docs      # vite dev, from the repo root
bun run build:docs    # vite build -> packages/docs/build/
bun run check:docs    # svelte-check, also part of the root `bun run check`
```

All three run through `scripts/docs.ts` (not plain `vite`/`svelte-check`
invocations), which handles two things every one of them needs first, see that
file's own comment for the full detail:

- Writes a stub `.svelte-kit/tsconfig.json` at the _repo root_ if one doesn't
  already exist — a real, tested rolldown-vite bug (this repo's pinned
  `vite`/`rolldown` are both pre-1.0/beta) resolves
  `packages/docs/tsconfig.json`'s `extends` chain against the repo root instead
  of `packages/docs/` itself, and fails outright if that root file doesn't
  exist. Invisible locally the moment `bun run dev`/`check:app` has run once;
  caught for real by a clean Docker build (see the root `Dockerfile`'s
  `docs-builder` stage, which hits this from scratch every time).
- Copies the repo root's own checked-in `openapi.json` into
  `packages/docs/static/openapi.json` (best-effort — a fresh checkout that
  hasn't run `bun run gen` yet just gets a working site minus a functional
  `/docs/api` page until it does), so the Swagger UI page has a real spec to
  serve as a static asset. Not committed (`packages/docs/static/openapi.json` is
  gitignored), regenerated on every `dev`/`build`/Docker build instead.

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

## API reference page

`src/routes/docs/api/+page.svelte` embeds Swagger UI (`swagger-ui-dist`, already
a root dependency, same package the main dashboard's own `(protected)/api-docs`
page uses) against `/openapi.json` — a static asset copied in at dev/build time
(see above), not fetched from a live instance. "Try it out" there needs a real
instance's own `x-api-key` pasted in, same caveat the main app's own API docs
page carries.

## Deploying it

`docker build --target docs -t homerun-docs .` from the repo root (or
`docker-bake.hcl`'s `docs`/`docs-ci` targets) builds a small `nginx:alpine`
image serving the static output on port 80 — see the root `Dockerfile`'s
`docs-builder`/`docs` stages. Wired into the release pipeline as
`orochibraru/homerun-docs` alongside the app/agent images
(`.github/workflows/publish.yaml`'s `build:docs` job).
