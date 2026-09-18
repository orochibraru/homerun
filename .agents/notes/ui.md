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

- **Two typefaces, and mono is now rare.** `--font-sans` is Inter Variable
  (`@fontsource-variable/inter`), and the root font size is 110% so the whole
  rem-based UI (type and spacing) renders a notch larger; `--font-mono` is
  JetBrains Mono, and it is reserved for **code, logs and terminal output** :
  `live-log-viewer.svelte`, `ansi-line.svelte`, the Terminal tab, System Logs,
  the Errors tab and the env paste box. Everything else — nav, labels, status
  badges, metrics, image refs, hostnames — is sans. An earlier pass made mono
  the UI's voice across the board and it read as a terminal emulator rather than
  an app. `tech` survives as _tabular figures only_ (`font-variant-numeric`), so
  live-updating numbers still don't reflow.
- **The design is ported from Penombre** (`orochibraru/penombre`'s
  `src/app.css`), deliberately, because that app's look is the target. Four
  things carry it:
  - **The aurora.** `body::before` paints two oversized, heavily blurred radial
    colour fields on opposite corners (`--brand-2` pink top-right, `--brand-3`
    cyan bottom-left), `filter: blur(72px) saturate(140%)`, fixed so they stay
    put while content scrolls. `html` holds the solid ground (`--color-bg`) and
    `body` is transparent, so panels above can be translucent without stacking
    washes.
  - **Film grain.** `body::after` is an inline SVG `feTurbulence` at 3.5%
    opacity, `mix-blend-mode: soft-light`. It exists so the aurora's gradient
    doesn't band; keep it subtle enough that type stays crisp.
  - **Frosted panels.** `panel` is a translucent `--color-surface` +
    `backdrop-filter: blur(10px)` + hairline border. The blur is deliberately
    light : heavier turns the gradient behind a card into a visible rectangle.
    `panel-strong` is the near-opaque, heavily blurred variant for chrome that
    overlaps scrolling content (the sticky header, the mobile drawer).
  - **A violet brand.** `--color-accent` (and `--color-ink`, the fill primary
    buttons paint with) is `oklch(0.54 0.25 293)` in light, brighter in dark.
    `--radius` is `0.75rem` : soft corners, not the tightened technical ones a
    previous pass used.
- **The shell is a rail plus a floating pane.** `(protected)/+layout.svelte` is
  `flex h-screen p-2 md:gap-2`: a transparent 14rem sidebar sitting directly on
  the aurora (no panel of its own), and the page itself a `panel rounded-xl`
  pane with the sticky header inside it. The sidebar carries the one primary
  action (`Deploy a service`, full width, brand-filled) above the nav, the way
  Penombre's "New" button does.
- **The accent picker has to move more than one variable, and it has to move
  them on the document root.** `/profile/appearance` writes `--color-accent`,
  and the `(protected)` layout's `accentCss` also sets `--color-ink`,
  `--primary` and `--ring` from the same hex. Overriding only `--color-accent`
  leaves every button on the stock violet, which is exactly what "the accent
  switch doesn't work on buttons" meant. Two further traps, both real bugs that
  shipped:
  - **It's a `<svelte:head>` rule, not a `style=""` on the layout wrapper.**
    bits-ui portals every dialog, popover, dropdown and tooltip out to
    `document.body`, so anything rendered inside one sits outside that wrapper
    and keeps the stock colour — which is how the notification bell's link
    buttons stayed violet while the page behind them followed the picker.
  - **The selector is `:root:root`, not `:root`.** SvelteKit assembles its head
    as `[component head, style tags, stylesheet links]` (`Head.build()` in
    `@sveltejs/kit`'s `render.js`), so a `<svelte:head>` rule is emitted
    _before_ `layout.css` and loses a same-specificity tie against it. Doubling
    the selector wins on specificity instead, over both `:root` and `.dark`,
    whatever the order. `tests/e2e/ui-appearance.spec.ts` asserts the chosen hex
    reaches a portaled popover, which is the assertion that caught both.
- **`eyebrow`** is a small sans semibold label (no longer uppercase mono), used
  for panel titles and sidebar group headings. **`metric`** is the large tabular
  number on the stat tiles. **`panel-head`** is the shared card-header strip.
- Both themes are real and both are checked : light is `:root`, dark is `.dark`
  (driven by `mode-watcher`). Every token that differs between them is redefined
  in both blocks, a color defined only in one is a bug.

**`layout.css` is formatted by biome, not prettier.** Biome owns CSS here
(`biome.json`'s `css.parser`), and it indents with tabs; prettier has no
`useTabs` in `.prettierrc` and rewrites the whole file to spaces, which is a
600-line diff that nothing then checks. Run `bunx biome check --write` on it.

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

**One list/grid component, `entity-list.svelte`.** It takes `items` (each
`{id, title, subtitle?, description?, href?}`) plus optional
`media`/`badge`/`meta`/`actions` snippets and a `selectedIds`/`onToggleSelect`
pair, and renders both the list view (one `panel`, rows separated by hairlines)
and the card view from the same data. It replaced `entity-list-view.svelte`,
which took raw `row`/`card` snippets : every page drew its own row chrome, so
each list had different padding, and once the shared container became a panel
the pages that still drew a `panel` per row showed **double borders with no gap
between items**. Services, templates, stacks and storage go through it; the
remaining five list pages (remote hosts, S3 destinations, cron jobs, build
cache, git providers) still hand-roll their row internals inside the same
panel/divider shell, see `TODO.md`.

`entity-list.svelte` also takes a **`wrapper`** snippet, which the services list
uses to put every row inside a right-click `ContextMenu` (start/stop/ restart,
settings, delete, Link to…, group into a stack, ungroup) without each page
rebuilding its own row markup. The wrapper receives the item and a no-argument
body snippet; that shape is deliberate, a `Snippet<[T]>` body can't be assigned
across the generic boundary.

**The resource graphs** (`usage-chart.svelte`, `service-usage-table.svelte`)
read `stat_sample` through `$lib/remote/stats.remote.ts`. The chart is a plain
inline SVG path over a `0 0 100 40` viewBox — no chart library, same "a
self-hosted app shouldn't need a CDN" reasoning as the bundled fonts — with
metric (CPU/memory/traffic) and range (live…all) switches, and it refreshes
itself every 5s only on the live range. `service-graph.svelte` is the service
overview's Connections diagram.

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
viewport** (`p-5 md:p-6`, no `mx-auto`, no `max-w-*`). `/authentication` shipped
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
Remote functions below), `alert.svelte` (the inline banner, `error`/`warning`/
`info`/`success`, optional `title` and `actions` snippet, `role="alert"` when
it's an error — eight pages had hand-rolled the same
`border-red-200 bg-red-50 …` div before it existed), `async-block.svelte`
(pending/ready/failed over one remote query, with a Retry, see Remote functions
in `services-and-templates.md`), and `error-boundary.svelte` (a
`<svelte:boundary>` whose `failed` snippet is an `Alert` with a **Try again**
that calls `reset` — wrapped around `{@render children()}` in
`(protected)/+layout.svelte`, so a render error in any dashboard page is a
banner in the content area with the sidebar and header still usable, instead of
a blank screen). If you're touching a page with an inline empty-state or the
same three class-string literals, prefer wiring in the shared version over
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

**The list-page toolkit**, used by every entity list page (services, stacks,
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
  there's no client state left to bind. Replaced the bespoke
  search-input-plus-category-`Drawer` that used to be inlined in the templates
  gallery only (see Built-in template catalog and gallery below); pages without
  a card view (remote-hosts, s3-destinations, build-cache-registries, users,
  backups) use it for search/filter alone, with no `trailing` snippet.
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
  module rather than living inside `entity-list.svelte`, specifically so one
  page can render several `EntityList`s sharing a single toggle (services groups
  its rows by stack, one `EntityList` per group); before this, each group
  toggled independently, a real pre-existing bug this fixes, not just a
  refactor.
- `entity-list.svelte` takes `view: ViewMode` plus an optional `cardGridClass`
  (defaults to a 3-column grid; templates passes a 4-column one). Its old
  `viewKey` string prop and its module-block `EntityViewMode` export are gone,
  that type now lives on `$lib/view-mode.svelte.ts`. Every list page now renders
  straight from `data` (already one page, already filtered/searched) rather than
  deriving a client-side `filtered` array, and tells a true empty state apart
  from a no-match one via `data.total === 0 && !data.filtered`.

**The signed-out surfaces** (`auth/sign-in`, `auth/sign-up`,
`auth/sign-up/confirm`, `auth/accept-invite`, `auth/error`) all render through
`auth-shell.svelte`: one `max-w-md` column centred on an otherwise empty page,
carrying `brand-mark.svelte`, then the heading block, then the form in a `panel`
card. It takes `eyebrow`/`heading`/`subheading` props plus `children` (the
form), an optional `below` snippet for content outside that card (the confirm
page's dev-bypass panel) and an optional `footer` snippet for the trailing
"Don't have an account?" line. It used to be a two-pane layout with a
product-pitch panel (highlights, a mono deploy-log card, a blurred accent blob)
filling the left half — deliberately dropped: this is a single-user self-hosted
app's login screen, nobody arriving at it needs to be sold the product.
`brand-mark.svelte` is the accent square + `homerun` mono wordmark from the
sidebar, in `sm`/`lg`; it's also the "gated by" footer on `app-auth`.
`password-field.svelte` (label + `Input` + show/hide eye toggle) and
`password-strength.svelte` (the four-bar meter over `getPasswordStrength`)
replaced the copy of that markup each of those four forms carried. The pages
that predated this also carried stale `LocalRun` branding and a hand-rolled
`inputClass`, both gone.

**Every list page now renders its rows through `entity-list.svelte`.** Remote
hosts, S3 destinations, cron jobs, build cache registries and git providers used
to hand-roll their row internals inside the same panel/divider shell, which is
how they drifted : different title weights, different subtitle separators, a
status line in one and a badge in another. They map their rows to `EntityRow`
(`id`/`title`/`subtitle`/`description`/`href`) and pass the page-specific parts
as `media`/`badge`/`meta`/`actions` snippets, which is what those snippets are
for — an agent's reachability line is `meta`, a provider's Connected pill is
`badge`. They gained a card view along the way, since `EntityList` takes a
`ViewMode` either way and the toggle costs one `trailing` snippet in the
toolbar. Git providers is the one exception to that: it has no toolbar, so it
stays list-only, and its admin-only callback URL moved from a bordered line
under the row into the row's own `description`.

`confirm-dialog.svelte` gained an optional `confirmPhrase` prop: when set, the
dialog renders an input and the confirm button stays disabled until the typed
text matches the phrase exactly (Enter in the input confirms too). This replaced
the old "append a confirmation div into the section" pattern (an inline
`{#if showDeleteConfirm}` toggling a form in place) with a real modal everywhere
that pattern appeared: the service Settings danger zone and the stack detail
danger zone (typed phrase is the entity's own name), and the services list's own
per-row delete (service name) and new bulk delete (`delete N services`, see the
services list bullet below). The profile Security page's account deletion moved
into a `Dialog` too, but keeps its existing password gate instead of a typed
phrase, the password already serves that purpose. The remote-host detail page
already used `ConfirmDialog` before this and needed no change.

**Verified live** in a real browser: the toolkit's search/filter narrowing, one
`ViewMode` toggle staying in sync across a grouped list that renders several
`EntityListView`s (services' per-stack groups), select-all plus the bulk bar,
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
Information/Security/Sessions/Authorized Clients/Notifications, the last of
which sets the event x channel matrix for Outbound notification channels, see
`observability.md`), backed by `profile/appearance/+page.server.ts`'s three
actions (`updateTheme`/`updateSidebar`/`updateAccent`, each validated by its own
zod schema in `$lib/server/validation/appearance.ts`) calling
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
