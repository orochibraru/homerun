# UI, design system, components

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Design system and theming (`src/routes/layout.css`)

One file owns the whole visual language : the palette, the radius scale, the
fonts, and the four custom Tailwind v4 `@utility` definitions every surface is
built from. Nothing under `src/routes`/`src/lib` should hardcode a hex value or
a blur/shadow stack, route it through a token here instead.

- **Two typefaces.** `--font-sans` is Inter (self-hosted `@font-face` blocks
  pointing at `static/fonts/`, plus the `@fontsource-variable/inter` import);
  `--font-mono` is **JetBrains Mono** (`@fontsource-variable/jetbrains-mono`,
  bundled, no CDN, same "a self-hosted app shouldn't need outbound internet to
  render" reasoning as the Swagger UI docs page). Mono is not decorative : it
  carries every machine-readable string, image refs (`redis:alpine`), slugs and
  hostnames, image digests, metrics, status badges, and section labels, which is
  most of what makes this read as infrastructure tooling rather than a generic
  dashboard.
- **`panel`** is the card treatment : an **opaque** `--color-surface`, a 1px
  border, a hairline inner top rule (`--panel-rule`) and a tight shadow. It
  replaced a `glass` utility (translucent surface + `backdrop-filter`
  blur/saturate + a specular sheen gradient) that sampled an ambient backdrop
  painted on `body::before`/`::after` : three radial color pools plus a 44px
  engineering grid. All of that is gone, deliberately. Translucency over a
  tinted, gridded ground washed every surface toward the same mid-grey, which is
  what made the app read as flat and low-contrast no matter how the text tokens
  were tuned. The ground is now a flat `--color-bg` and panels are opaque, so a
  card's edge is a real edge. **`panel-strong`** is the chrome variant (it
  paints `--sidebar` rather than `--color-surface`); **`panel-interactive`**
  adds the hover lift.
- **`ink-surface`** is the signature element : a permanently dark surface in
  _both_ themes, used for the sidebar and the mobile drawer. It isn't just a
  background, it redefines `--color-text`/`--color-text-muted`/
  `--color-text-subtle`/`--color-surface-2`/`--color-border` for its own
  subtree, so every `text-text-muted`/`bg-surface-2` utility underneath it flips
  to the dark-ground values without a single `dark:` variant in the markup.
  That's what makes a dark rail against a white canvas work in light mode.
  Anything else that wants an inverted region should use this class, not
  hand-written `dark:` pairs.
- **`tech`** is `--font-mono` + `tabular-nums`, for any number that updates live
  (the dashboard's 5s stats poll) so digits don't reflow as they change.
  **`eyebrow`** is the small uppercase mono section label used for every panel
  title and sidebar category heading ; it's `--color-text` at weight 600, not a
  muted grey, because it _is_ the panel's title.
- **`--color-ink`/`--color-ink-foreground`** are the primary-action pair, and
  they invert per theme : near-black with white text in light, near-white with
  black text in dark. The default `Button` variant uses them, which is why the
  main action on every page reads as the highest-contrast thing on it. Reserve
  `--color-accent` for state (active tab underline, active nav rail, links,
  focus rings, the brand square) rather than for filled buttons.
- **The radius scale is deliberately tight** : `--radius` is `0.375rem` and the
  multiplier curve is flat, so `rounded-2xl` resolves to `0.5625rem`. Card
  corners are the single biggest "toy vs. tool" tell, don't loosen them up.
- Both themes are real and both are checked : light is `:root`, dark is `.dark`
  (driven by `mode-watcher`, see Appearance preferences below). Every token that
  differs between them is redefined in both blocks, a color defined only in one
  is a bug.

**Sweeping this file's tokens is how a global visual change is made**, not a
per-route pass : both redesigns so far changed ~65 files, and almost all of that
was one mechanical substitution (`border border-border bg-surface` → `glass` the
first time, `glass` → `panel` the second). **A real bug came out of doing that
with a `\b`-anchored regex**: `bg-surface\b` matches inside `bg-surface-2`,
silently producing a bogus `glass-2` class that Tailwind emits nothing for.
Match on whole class tokens, not substrings, and order the replacements
longest-first (`glass-strong` before `glass`) for the same reason. `\bglass\b`
also matches inside `--glass-highlight`, which is how a dangling
`var(--panel-highlight)` got left behind in three files : grep the CSS variable
names separately afterward.

**Verify a visual change by actually looking at it.** `tests/e2e/`'s harness
boots a real app against a real Postgres (`bun run build:app`, then a throwaway
spec under `tests/e2e/` run with `bun run test:e2e -- tests/e2e/<name>.spec.ts`)
: sign up, click through onboarding, and screenshot the pages you touched in
both themes (set `localStorage["mode-watcher-mode"] = "dark"` and reload for the
dark pass). Delete the spec afterward. Reasoning about token values alone is how
you ship a button that turns out to be grey.

## Page width and layout

Covered as a hard rule under Conventions above, repeated here because it's a
layout decision rather than a code-style one: **dashboard pages fill the
viewport** (`p-6 md:p-8`, no `mx-auto`, no `max-w-*`). `/authentication` shipped
with `mx-auto max-w-4xl` and looked broken on an ultrawide display, with the
whole page squeezed into a centre column; `remote-hosts/[hostId]` had the same
defect (`mx-auto max-w-2xl`). Both now follow the same wrapper every other page
uses.

## Shared UI components (`src/lib/components/`)

Not a full componentized design system, this app still doesn't have one, but a
real shared list-page toolkit now exists alongside the smaller extracted
patterns: `status-badge.svelte` (pre-existing), `empty-state.svelte`
(icon/title/subtitle + optional CTA snippet, used on Storage and Remote Hosts so
far, other list pages still have their empty state inlined), `form-styles.ts`
(the `inputClass`/`labelClass`/`errorClass` Tailwind strings almost every form
page redefines identically, imported directly as class strings, not a wrapper
component, so it doesn't force a markup shape change on pages that predate it;
wired into Remote Hosts and the service Networking tab so far), `stepper.svelte`
(the step-indicator-bar-plus-Back/Next chrome and unlocked-step gating every
multi-step form needs, extracted while building the onboarding wizard, see
Onboarding below; not yet retrofitted onto `services/new`'s own inlined
equivalent), and `skeleton.svelte` (one pulsing placeholder block, sized by a
`class` prop, the pending branch every remote-query-backed panel renders, see
Remote functions below). If you're touching a page with an inline empty-state or
the same three class-string literals, prefer wiring in the shared version over
copy-pasting again, but this is opportunistic, not a mandate to refactor
unrelated pages.

**Self-loading components**, the ones that fetch their own data through a remote
query rather than taking it as a prop off a route's `load` (see Remote functions
below), so a page that wants one just renders it: `host-resources.svelte` (the
dashboard's Host Resources panel, own 5s poll), `job-queue-panel.svelte`
(Scheduling's job queue, own 3s poll), `notification-bell.svelte` (the header's
feed, plus its own mutations), `git-repo-picker.svelte` (the "Browse repos"
picker, shared by `services/new` and the service Source tab, calls back with the
picked repo), and `image-check-warning.svelte` (the debounced "this image wasn't
found in its registry" warning, shared by the same two pages).

**The list-page toolkit**, used by every entity list page (services, projects,
templates, storage, remote-hosts, s3-destinations, build-cache-registries,
users, backups):

- `entity-toolbar.svelte` is **URL-driven**, not prop-bound: it reads the
  current `q` and each filter group's value straight off `page.url.searchParams`
  and writes changes back with `goto(url, {keepFocus, noScroll, replaceState})`,
  debounced 300ms for the search box, clearing every page param in `pageParams`
  (default `["page"]`) on every change so a new search/filter always lands back
  on page 1. Props are `filters` (`FilterGroup[]`, each
  `{key, label, options: {label, value}[]}`), `pageParams`, `placeholder`, and a
  `trailing` snippet slot (where a page renders `ViewModeToggle`); the old
  bindable `search`/`selected` props and the exported `FilterSelection` type are
  gone, filtering moved server-side (see Server-side list pagination above), so
  there's no client state left to bind. `$lib/filtering.ts` (`matchesQuery`/
  `matchesFilter`) still exists but is no longer used by any list page. Replaced
  the bespoke search-input-plus-category-`Drawer` that used to be inlined in the
  templates gallery only (see Built-in template catalog and gallery below);
  pages without a card view (remote-hosts, s3-destinations,
  build-cache-registries, users, backups) use it for search/filter alone, with
  no `trailing` snippet.
- `pagination.svelte`: Previous/Next plus "26–50 of 60 services" and "Page 2 of
  3", also URL-driven (`goto()`, same as the toolbar), rendered only when
  `total > perPage`. Takes `page`/`perPage`/`total` (a page's `PagedResult`, see
  Server-side list pagination above) plus an optional `pageParam` (default
  `"page"`) and `label`, so a page with two independent paged lists (the
  templates gallery's built-in/custom sections) can render two of these against
  two different params.
- `view-mode.svelte.ts`'s `ViewMode` class + `view-mode-toggle.svelte`: one
  page's list/card preference, persisted in `localStorage` under
  `homerun:view:<key>` (`new ViewMode("services")`, optional 2nd arg is the
  fallback mode, e.g. `new ViewMode("templates", "card")`). Deliberately its own
  module rather than living inside `entity-list-view.svelte`, specifically so
  one page can render several `EntityListView`s sharing a single toggle
  (services groups its rows by project, one `EntityListView` per group); before
  this, each group toggled independently, a real pre-existing bug this fixes,
  not just a refactor.
- `entity-list-view.svelte` now takes `view: ViewMode` plus an optional
  `cardGridClass` (defaults to a 3-column grid; templates passes a 4-column
  one). Its old `viewKey` string prop and its module-block `EntityViewMode`
  export are gone, that type now lives on `$lib/view-mode.svelte.ts`. Every list
  page now renders straight from `data` (already one page, already
  filtered/searched) rather than deriving a client-side `filtered` array, and
  tells a true empty state apart from a no-match one via
  `data.total === 0 && !data.filtered`.

**The signed-out surfaces** (`auth/sign-in`, `auth/sign-up`,
`auth/sign-up/confirm`, `auth/accept-invite`, `auth/error`) all render through
`auth-shell.svelte`: a two-pane layout with a brand/pitch panel on the left
(hidden below `lg`, carrying `brand-mark.svelte`, three product highlights and a
mono deploy-log card) and a `max-w-md` form column on the right, taking
`eyebrow`/`heading`/`subheading` props plus `children` (the form, rendered in a
`panel` card), an optional `below` snippet for content outside that card (the
confirm page's dev-bypass panel) and an optional `footer` snippet for the
trailing "Don't have an account?" line. The two panes are deliberately different
grounds — `--color-surface` on the pitch side, `--color-bg` on the form side,
with a full-height accent rail down the far left edge — rather than one field
with a blurred color blob floating over it, which is what it used to be.
`brand-mark.svelte` is the accent square + `homerun` mono wordmark from the
sidebar, in `sm`/`lg`; it's also the "gated by" footer on `app-auth`.
`password-field.svelte` (label + `Input` + show/hide eye toggle) and
`password-strength.svelte` (the four-bar meter over `getPasswordStrength`)
replaced the copy of that markup each of those four forms carried. The pages
that predated this also carried stale `LocalRun` branding and a hand-rolled
`inputClass`, both gone.

`confirm-dialog.svelte` gained an optional `confirmPhrase` prop: when set, the
dialog renders an input and the confirm button stays disabled until the typed
text matches the phrase exactly (Enter in the input confirms too). This replaced
the old "append a confirmation div into the section" pattern (an inline
`{#if showDeleteConfirm}` toggling a form in place) with a real modal everywhere
that pattern appeared: the service Settings danger zone and the project detail
danger zone (typed phrase is the entity's own name), and the services list's own
per-row delete (service name) and new bulk delete (`delete N services`, see the
services list bullet below). The profile Security page's account deletion moved
into a `Dialog` too, but keeps its existing password gate instead of a typed
phrase, the password already serves that purpose. The remote-host detail page
already used `ConfirmDialog` before this and needed no change.

**Verified live** in a real browser: the toolkit's search/filter narrowing, one
`ViewMode` toggle staying in sync across a grouped list that renders several
`EntityListView`s (services' per-project groups), select-all plus the bulk bar,
`confirmPhrase` enabling the confirm button only on an exact match, and real
single and bulk deletes. A bulk action where every service fails surfaces the
first rejection's message rather than reporting success.

## The `$derived` + push/splice anti-pattern (real, tested bug)

**Real, tested-in-review finding**: three forms, the Settings page's OAuth
Providers list, `services/new`'s env-var rows, and the service Env Vars tab's
own rows, declared their editable row array with `$derived(...)` and then
mutated it directly (`rows.push(...)`/`rows.splice(...)`), which is exactly why
"Add provider" on the Settings page did nothing observable (the bug that
prompted this fix): a `$derived` value is computed from its dependencies, not a
mutable store, pushing onto it doesn't reliably stick the way it would on
`$state`. Fixed by converting all three to `let rows = $state(...)` seeded once,
with an `$effect` re-syncing from the source data
(`data.settings.oauthProviders`/`data.template`/`svc.envVars`) whenever it
actually changes, not on every keystroke, so in-progress edits aren't clobbered.
`templates/new/+page.svelte`'s equivalent env-var rows already used `$state`
correctly and was the reference proving the fix, if you're adding a new
push/splice-mutated row list anywhere in this app, copy that shape (or the
now-fixed three), never `$derived`.

## Appearance preferences (`user_preferences` table, `UserPreferencesDTO`, `/profile/appearance`)

Per-account, not instance-wide (contrast `instance_settings`, which every other
"live-editable config" section in this document is about): a new "Appearance"
tab on the profile layout (`profile/+layout.svelte`, alongside Personal
Information/Security/Sessions/Authorized Clients), backed by
`profile/appearance/+page.server.ts`'s three actions
(`updateTheme`/`updateSidebar`/`updateAccent`, each validated by its own zod
schema in `$lib/server/validation/appearance.ts`) calling
`UserPreferencesDTO.get(userId)`'s `updateTheme`/`updateSidebarColorIntensity`/
`updateAccentColor`, which share `InstanceSettingsDTO`'s private-`persist()`
-per-section shape but per-user instead of a singleton row.

- **Theme**: `mode-watcher` (already an installed dependency, mounted in the
  root `+layout.svelte`) was previously dead code, hardcoded to
  `<ModeWatcher defaultMode="light" />` with no UI ever exposing a way to change
  it, despite `layout.css`'s `.dark` rules already being fully built out. Now
  `<ModeWatcher />` (mode-watcher's own default, `"system"`), and the Appearance
  page's theme selector calls `setMode()` directly for an instant client-side
  preview, with the DB save (`updateTheme` action) as the durable, cross-device
  copy. `(protected)/+layout.svelte`'s `onMount` seeds a browser that has no
  `mode-watcher-mode` localStorage entry yet (a first visit on a new
  device/browser) from `data.preferences.theme`, so the account's saved choice
  follows across devices; a browser that already has its own mode-watcher entry
  is left alone, that entry owns it from then on. This is additive to, not a
  replacement for, mode-watcher's own localStorage persistence.
- **Sidebar color intensity**: `(protected)/+layout.svelte`'s existing
  `categoryColors` map (Administration=red, Infrastructure=emerald,
  Integrations=violet, Workspace=accent) is now conditionally bypassed by a
  `colorful` derived boolean; when `sidebarColorIntensity === "accent"`, every
  category's `{@const color = ...}` resolves to the shared `fallbackColor`
  (Workspace's accent entry) instead of its own.
- **Accent color**: `(protected)/+layout.svelte`'s root wrapper div gets an
  inline `style` computed from `accentColor` (a `"#rrggbb"` hex string, `null`
  meaning "use the built-in default") that overrides
  `--color-accent`/`--color-accent-light`/`--color-accent-glow` for that whole
  subtree; every `bg-accent`/`text-accent`/etc. Tailwind utility already
  references those CSS vars rather than a literal value (Tailwind v4's `@theme`
  block), so no component needs to know about the override. Scoped to
  `(protected)/` only, not pre-login pages, since this is a dashboard
  preference, not a site-wide brand color.
- `(protected)/+layout.server.ts`'s shared `load` (same one that fetches
  notifications, see above) now also fetches `UserPreferencesDTO.get(...)` and
  returns `preferences: preferences.toJSON()`, since the sidebar itself, not
  just the Appearance page, needs it on every protected render.
