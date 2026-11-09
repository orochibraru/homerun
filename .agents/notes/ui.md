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

- **Two typefaces, and mono is rare.** `--font-sans` is Nunito
  (`@fontsource-variable/nunito`) and `--font-mono` is Geist Mono, reserved for
  **code, logs, terminal output, slugs and image refs**. Everything else (nav,
  labels, status pills, metrics, hostnames) is sans. Lanes runs heavy on
  purpose: body text is 550 and Tailwind's weight scale is shifted up one step
  (`--font-weight-medium` 600, `semibold` 700, `bold` 800), so `font-medium`
  across the app reads bolder without touching every file. `tech` is _tabular
  figures only_ (`font-variant-numeric`), so live-updating numbers don't reflow.
- **The default accent is bordeaux** (`oklch(0.4 0.12 20)` in light, a lighter
  `0.74` text accent and a `0.46` fill in dark), set on `:root`/`.dark` and
  replaced wholesale by a palette (`src/lib/palettes.ts`). Low-opacity tints of
  it read as pink, so `--color-accent-light` and `--accent` (selected rows,
  hover fills) are a desaturated version of it rather than the accent at a few
  percent. Primary buttons are filled with the accent, never black.
- **The shell is a sidebar plus a pane.** `(protected)/+layout.svelte` is
  `data-slot="app-shell"`; under Lanes it has no padding or gap, the sidebar
  sits on `--color-bg` with a hairline on its right, and the page
  (`data-slot="app-frame"`) is full-bleed on `--color-pane`, with a borderless
  header. In light both are plain white (a grey ground read as grim); in dark
  the pane is a step lighter than the sidebar. Presets keep the padded,
  floating-window shell because those overrides are scoped to Lanes. Cards
  (`panel`) carry a hairline (`--panel-border-color`) and a faint shadow, since
  white on white needs the edge. The sidebar carries the one primary action
  (`Deploy a service`) above the nav; its items are pills, the current one
  tinted with `--color-surface-2` and its icon in the accent.
- **Every tab carries an icon.** `NavTab.icon` (`TabNav`) and `SectionLink.icon`
  (`SectionNav`) are required, so a tab without one fails the type check, and
  every segmented control or pill switch (the services status filter, the
  Overview's metric switch, the resource chart's metric and range switches,
  Monitoring's range picker, permission levels, network mode, the list/card
  toggle) puts a lucide icon at `size-3.5` before its label. Dropdowns
  (`Select`) don't.
- **Pills, not boxes.** Under Lanes, buttons, `TabNav` (a segmented control
  whose active tab is filled with the accent), `SectionNav` items, the header's
  search and controls, and status badges (`status-badge.svelte`: outlined, an
  icon and coloured bold text on the card colour) are fully rounded. Inputs keep
  a `0.75rem` radius. A page's `h1.text-lg` title is enlarged to 24px by one
  Lanes rule instead of per page.
- **Dashboard building blocks.** `kpi-tile.svelte` (an icon in a round chip, a
  label, a big value with its unit, an optional delta pill; the `hero` tone is
  the accent gradient, `sand`/`mauve`/`sky` are soft tints from `--tile-b/c/d`)
  and `ring-gauge.svelte` (a progress ring in the accent with optional centre
  content) are shared by the Overview and service pages. Bar charts use
  `--bar-fill`/`--bar-stripe` for the muted hatched bars and the accent for the
  highlighted one.
- **Every chart answers a hover.** The tooltip is always `chart-tooltip.svelte`
  (an inverted pill, `x`/`y` in px from the nearest `relative` box, `above` or
  `below`), never a hand-rolled one or a `title`. A chart with many entries
  (bars, lines, strips) keeps its highlight in a `ChartHover`
  (`src/lib/chart-hover.svelte.ts`): `track` on pointer move and down, `leave`
  (a mouse clears it, a touch keeps it), `key` for the arrows, Home and End,
  `clear` on blur, `bind:clientWidth={hover.width}` and `hover.x` for the
  tooltip's clamped x. The plot is a focusable `role="slider"` with an
  `aria-valuetext` naming the entry; the hovered bar stays and the others dim, a
  line gets a crosshair and a dot. A strip that sits inside a link
  (`lane-strip.svelte` in the services tree and diagram) is pointer-only, since
  a focusable control can't nest in an `<a>`. A single value (a ring, a meter, a
  capacity bar) goes in `chart-hover-target.svelte`, a button that shows its
  `tip` snippet on hover, focus or tap. The pure lookups (`bucketAt`,
  `nearestPoint`, `stepIndex`, `entryX`, `clampX`) live in
  `src/lib/chart-hover.ts`. Show only what the component already has: `Lane`
  carries its `start` and each deploy's `at` for exactly that. Inside an
  `overflow-hidden` panel, the first row opens its tooltip `below`.
- **Navigation up is the header's breadcrumb trail, not per-page back links.**
  `breadcrumbs.svelte` builds it from the URL: top-level segments take their
  sidebar label, an id segment takes the `name`/`label`/`title` of whichever
  `page.data` object has that `id`, anything else is the humanized segment.
  Don't add an `← Parent` link to a page; a URL prefix that isn't a real page
  goes in the layout's `skip` list. A page whose place in the hierarchy isn't
  its URL returns `crumbRoot` (a list of `{ href, label }`) from its `load` to
  stand in for the first segment: a service in a stack reads
  `Stacks › <parent stacks…> › <stack> › <service>` although its URL is
  `/services/<id>`, and a nested stack's own pages list its parents the same
  way. The pane's `<main>` is `relative` so absolutely-positioned content
  (`sr-only` spans) is contained by its scroll area instead of stretching the
  document into a second scrollbar.
- **Colours come from palettes, and they have to move more than one variable, on
  the document root.** `/profile/appearance` picks a palette
  (`src/lib/palettes.ts`: an accent plus five chart hues) or a custom accent;
  `appearanceCss` turns that into `--color-accent`, `--color-ink`, `--primary`,
  `--ring`, the `--chart-*` hues and the aurora's `--brand-2/3`, and only ever
  emits a known palette or a validated hex. Category tiles use the `chart-*`
  tokens (`TEMPLATE_CATEGORY_COLORS`), so they follow the palette too.
  Overriding only `--color-accent` leaves every button on the stock violet,
  which is exactly what "the accent switch doesn't work on buttons" meant. Two
  further traps, both real bugs that shipped:
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

**`layout.css` is formatted by `bun fmt`** like every other file, with tabs
(`useTabs` in `bunfig.toml`'s `[fmt]`).

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
remaining five list pages (remote hosts, backup destinations, cron jobs, build
cache, git providers) still hand-roll their row internals inside the same
panel/divider shell, see `TODO.md`.

`entity-list.svelte` also takes a **`wrapper`** snippet, which the services list
uses to put every row inside a right-click `ContextMenu` (start/stop/ restart,
settings, delete, Link to…, group into a stack, ungroup) without each page
rebuilding its own row markup. The wrapper receives the item and a no-argument
body snippet; that shape is deliberate, a `Snippet<[T]>` body can't be assigned
across the generic boundary.

**The resource graphs** (`usage-chart.svelte`, `service-usage-table.svelte`)
read `stat_sample` through `src/lib/remote/stats.remote.ts`. The chart is a
plain inline SVG path over a `0 0 100 40` viewBox — no chart library, same "a
self-hosted app shouldn't need a CDN" reasoning as the bundled fonts — with
metric (CPU/memory/traffic) and range (live…all) switches, and it refreshes
itself every 5s only on the live range. `service-graph.svelte` is the service
overview's Connections diagram.

**Verify a visual change by actually looking at it.** `tests/e2e/`'s harness
boots a real app against a real Postgres (`bun run build`, then a throwaway spec
under `tests/e2e/` run with `bun run test:e2e -- tests/e2e/<name>.spec.ts`) :
sign up, click through onboarding, and screenshot the pages you touched in both
themes (set `localStorage["mode-watcher-mode"] = "dark"` and reload for the dark
pass). Delete the spec afterward. Reasoning about token values alone is how you
ship a button that turns out to be grey.

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
Onboarding below; `services/new` keeps its own `wizard-nav.svelte` since its
steps are all clickable at any time and it has two submit buttons),
`panel-header.svelte` (icon tile + eyebrow title + description + optional
trailing action, the header of most `panel` sections), `run-status-badge.svelte`
(a backup/cron run's running/success/failed state),
`git-build-fields.svelte`/`registry-fields.svelte` (shared by `services/new` and
the service's Environments & Deployments → Source section), and
`skeleton.svelte` (one pulsing placeholder block, sized by a `class` prop, the
pending branch every remote-query-backed panel renders, see Remote functions
below), `alert.svelte` (the inline banner, `error`/`warning`/ `info`/`success`,
optional `title` and `actions` snippet, `role="alert"` when it's an error —
eight pages had hand-rolled the same `border-red-200 bg-red-50 …` div before it
existed), `async-block.svelte` (pending/ready/failed over one remote query, with
a Retry, see Remote functions in `services-and-templates.md`), and
`error-boundary.svelte` (a `<svelte:boundary>` whose `failed` snippet is an
`Alert` with a **Try again** that calls `reset` — wrapped around
`{@render children()}` in `(protected)/+layout.svelte`, so a render error in any
dashboard page is a banner in the content area with the sidebar and header still
usable, instead of a blank screen). If you're touching a page with an inline
empty-state or the same three class-string literals, prefer wiring in the shared
version over copy-pasting again, but this is opportunistic, not a mandate to
refactor unrelated pages.

**Self-loading components**, the ones that fetch their own data through a remote
query rather than taking it as a prop off a route's `load` (see Remote functions
below), so a page that wants one just renders it: `host-resources.svelte` (host
CPU, memory and disk, own 5s poll), `job-queue-panel.svelte` (Scheduling's job
queue, own 3s poll), `notification-bell.svelte` (the header's feed, plus its own
mutations), `git-repo-picker.svelte` (the "Browse repos" picker, shared by
`services/new` and the service's Source section, calls back with the picked
repo), and `image-check-warning.svelte` (the debounced "this image wasn't found
in its registry" warning, shared by the same two pages).

**The list-page toolkit**, used by every entity list page (services, stacks,
templates, storage, remote-hosts, s3-destinations, build-cache-registries,
users, backups):

- `entity-toolbar.svelte` is **URL-driven**, not prop-bound: it reads the
  current `q` and each filter group's value straight off `page.url.searchParams`
  and writes changes back with `goto(url, {reset: false, replace: true})`,
  debounced 300ms for the search box, clearing every page param in `pageParams`
  (default `["page"]`) on every change so a new search/filter always lands back
  on page 1. The filters drawer edits a draft copy of the selection and only
  writes it to the URL on **Apply** (one navigation, one server query), never
  per click. Props are `filters` (`FilterGroup[]`, each
  `{icon?, key, label, options: {count?, icon?, label, value}[]}`: `count` is a
  server-side SQL count shown next to the option, like the templates gallery's
  `TemplateDTO.categoryCounts`), `pageParams`, `placeholder`, and a `trailing`
  snippet slot (where a page renders `ViewModeToggle`); the old bindable
  `search`/`selected` props and the exported `FilterSelection` type are gone,
  filtering moved server-side (see Server-side list pagination above), so
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
  page's list/card preference, stored per account in
  `user_preferences.view_modes` (a key to mode map, keys matching
  `VIEW_MODE_KEY` in `src/lib/view-modes.ts`), which the protected layout's
  `load` already returns as `data.preferences`, so the constructor reads it off
  `page.data` and the server renders the stored mode from the first byte (no
  `localStorage` read after mount, no flip on reload).
  `new ViewMode("services")`, optional 2nd arg is the fallback mode, e.g.
  `new ViewMode("templates", "card")`; construct it during component init.
  Switching updates at once and saves through the `setViewMode` remote command
  (`view-mode.remote.ts`, merged into the JSON in SQL by
  `UserPreferencesDTO.updateViewMode`) under a promise toast, switching back if
  the save fails, and mirrors the choice onto the cached layout data so coming
  back to the page in the same session keeps it. Deliberately its own module
  rather than living inside `entity-list.svelte`, specifically so one page can
  render several `EntityList`s sharing a single toggle (services groups its rows
  by stack, one `EntityList` per group); before this, each group toggled
  independently, a real pre-existing bug this fixes, not just a refactor.
- `entity-list.svelte` takes `view: ViewMode` plus an optional `cardGridClass`
  (defaults to a 3-column grid; templates passes a 4-column one). Its old
  `viewKey` string prop and its module-block `EntityViewMode` export are gone,
  that type now lives in `src/lib/view-modes.ts`. Every list page now renders
  straight from `data` (already one page, already filtered/searched) rather than
  deriving a client-side `filtered` array, and tells a true empty state apart
  from a no-match one via `data.total === 0 && !data.filtered`.
- Multi-select (services, storage): `list-selection.svelte.ts`'s `ListSelection`
  class holds the selected ids and, constructed during component init with a
  `() => visibleIds` getter, drops any id that leaves the visible page
  (paging/search/filter), so the bulk bar never submits rows you can't see.
  `select-all-row.svelte` is the select-all checkbox above the list;
  `EntityList` takes `selectedIds={selection.ids}` and
  `onToggleSelect={(id) => selection.toggle(id)}`; `bulk-action-bar.svelte` is
  the fixed bottom bar, a form posting every selected id under `idField` to
  `action`, with the page's own buttons as children (a destructive op submits
  through a hidden `name="op"` button after a `ConfirmDialog`). The page's
  `?/bulk` action returns `{ succeeded, failed }` (storage adds `skipped`: bulk
  enable only turns on volumes that already have a schedule and destination) for
  the toast.

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
hosts, backup destinations, cron jobs, build cache registries and git providers
used to hand-roll their row internals inside the same panel/divider shell, which
is how they drifted : different title weights, different subtitle separators, a
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

## Hidden values and the env editor (`SECRET_MASK`, `env-vars-editor.svelte`)

Anything the dashboard shows hidden (a secret env var, an API key with no known
start, an OIDC app secret before its last four characters, a URL's password, the
masked `terraform.tfvars` preview, an empty password field's placeholder) uses
`SECRET_MASK` from `src/lib/formatting.ts`: 24 bullets whatever the real length,
so a mask never gives the length away. Don't write a bullet literal or a
length-derived `"•".repeat(value.length)` anywhere else.

A secret's real value is never put back into an input either: a password input
prefilled with it shows one dot per character. `env-vars-editor.svelte` (the
service's Environment Variables section and every cron job form) starts a marked
row with an empty value, `SECRET_MASK` as placeholder and `keep` set to its
stored name (`envEditorRows` in `env-parse.ts`); the row posts that name as
`envKeep` while its value is empty, typing clears it, and
`parseEnvVars(form, stored)` puts the stored value back. Unlocking an untouched
secret shows the stored value (`toggleEnvRowSecret`). Every other credential
form already posts an empty password field with a "leave blank to keep"
placeholder and keeps the stored secret server-side.

## The `$derived` + push/splice anti-pattern (real, tested bug)

**Real, tested-in-review finding**: three forms, the Settings page's OAuth
Providers list, `services/new`'s env-var rows, and the service's Environment
Variables section's own rows, declared their editable row array with
`$derived(...)` and then mutated it directly
(`rows.push(...)`/`rows.splice(...)`), which is exactly why "Add provider" on
the Settings page did nothing observable (the bug that prompted this fix): a
`$derived` value is computed from its dependencies, not a mutable store, pushing
onto it doesn't reliably stick the way it would on `$state`. Fixed by converting
all three to `let rows = $state(...)` seeded once, with an `$effect` re-syncing
from the source data
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
Information/Security/Sessions/API Keys/Authorized Clients/Notifications, the
last of which sets the event x channel matrix for Outbound notification
channels, see `observability.md`), backed by
`profile/appearance/+page.server.ts`'s three actions
(`updateTheme`/`updateAccent`, each validated by its own zod schema in
`src/lib/server/validation/appearance.ts`) calling
`UserPreferencesDTO.get(userId)`'s `updateTheme`/`updateAccentColor`, which
share `InstanceSettingsDTO`'s private-`persist()` -per-section shape but
per-user instead of a singleton row.

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
- **Sidebar**: no per-category colors. Every icon is `text-accent`; items are
  `font-medium`, the active one `font-semibold text-accent`. A "colorful"
  per-category mode existed and was removed as noise.
- **Lists**: the account's default page size (`updatePerPage`, validated by
  `perPageSchema` against `PER_PAGE_OPTIONS`), which every list page's `load`
  hands to `parseListQuery`, see Server-side list pagination in
  `data-and-config.md`. `pagination.svelte` has no per-page picker; `?perPage=`
  in the URL overrides it for one view.
- **Accent color**: `(protected)/+layout.svelte`'s root wrapper div gets an
  inline `style` computed from `accentColor` (a `"#rrggbb"` hex string, `null`
  meaning "use the built-in default") that overrides
  `--color-accent`/`--color-accent-light`/`--color-accent-glow` for that whole
  subtree; every `bg-accent`/`text-accent`/etc. Tailwind utility already
  references those CSS vars rather than a literal value (Tailwind v4's `@theme`
  block), so no component needs to know about the override. Scoped to
  `(protected)/` only, not pre-login pages, since this is a dashboard
  preference, not a site-wide brand color.
- **The look** is one style, Lanes (`DEFAULT_SURFACE` in `src/lib/surfaces.ts`):
  a `data-surface` attribute on `<html>`, `lanes` unless a preset overrides it,
  with its token overrides in `layout.css` (`[data-surface="lanes"]`, plus a
  `.dark[data-surface="lanes"], .dark [data-surface="lanes"]` block for what
  differs in dark). There used to be eight styles to pick from (Glass, Sleek,
  Neumorphism, Boxy, Claymorphism, Skeuomorphism, Material You and Lanes);
  migration 0152 dropped `user_preferences.surface_style` with the picker and
  their CSS. `panel` reads `--panel-bg`/`--panel-bg-image`/`--panel-backdrop`/
  `--panel-border-width`/`--panel-shadow`, buttons (`[data-slot="button"]`)
  `--button-shadow`/`--button-bg-image`, and `--radius-*` are re-derived under
  `[data-surface]` so the look's `--radius` takes. It's an attribute on
  `<html>`, not a class on the layout wrapper, for the same portal reason as the
  accent CSS above. It's rendered server-side: `app.html` has
  `data-surface="%homerun.surface%"`, the protected layout's `load` sets
  `locals.surface` and `hooks.server.ts`'s `transformPageChunk` fills it in, so
  there's no flash on load; the protected layout's `$effect` keeps it in sync on
  client navigation, and the Appearance page sets it directly to preview a
  preset. Because the selectors aren't `:root`-only, a `data-surface` on any
  element restyles its subtree, which is how the Appearance page's preset
  preview tiles work.
- **Lanes** (`lanes`, the default since migration 0151 and the only style since
  0152): Nunito and Geist Mono, cool grey neutrals with no aurora, grain or page
  wash, hairline cards on a white pane, pill controls, and the sidebar's icons
  in `text-subtle` with only the current page's in the accent (see the bullets
  at the top of this note). Colour is kept for status and for stacks: every
  style defines `--lane-0`..`--lane-3` (the palette's chart colours 1, 2, 3
  and 5) on `[data-surface]`, and `stackHues` (`src/lib/lanes.ts`) gives each
  top-level stack one of them, a substack sharing its root's.
- **The lane** (`lane-strip.svelte`) is the 24-hour strip drawn for a service on
  the Services Dependencies view, on the Diagram's cards and, counting stored
  log lines instead of requests (`noun="line"`, red on any error line with
  `errorShare={0}`, from `getLogLane` over `ServiceLogDTO.volume`), above the
  service Logs tab: 48 half-hour buckets whose opacity follows the square root
  of the bucket's share of the busiest one, red where a quarter or more of the
  bucket's requests errored, and a diamond per deployment (filled for the
  latest, red for a failed one). Its data is `getLanes` (`lanes.remote.ts`), one
  query for many ids, scoped to the caller's services, built by `buildLane` from
  `TrafficSampleDTO.seriesByService` and `DeploymentDTO.listSinceForServices`.
- **Presets** (`preset`, nullable: win95, win98, winxp, win7, msn, retro,
  `PRESETS` in `src/lib/surfaces.ts`) ride the same `data-surface` attribute:
  `effectiveSurface()` puts the preset there instead of `lanes` when one is set,
  so nothing of Lanes leaks in, and the protected layout drops the palette's
  accent CSS. A preset block forces a whole palette (text, surfaces, borders,
  accent, `color-scheme`, `--font-sans`, `--page-bg-image` for the desktop
  behind the page) regardless of light/dark, plus the title-bar strip
  (`[data-slot="panel-header"]`/`.panel-head`, `--panel-head-bg`/`-fg`), fields
  (`--field-*`) and buttons: only `data-variant` default, outline and secondary
  get the preset's button look (the button component sets `data-variant`), ghost
  and link stay flat. The protected layout's sidebar (`data-slot="app-sidebar"`)
  becomes a window and its top bar (`data-slot="app-header"`) a title bar: the
  sidebar otherwise sits on the preset's desktop background, which made Windows
  95/98/XP unreadable. Fonts are bundled (`@fontsource`: Pixelify Sans for
  95/98, DejaVu Sans behind Tahoma for XP, Open Sans behind Segoe UI for 7 and
  MSN, VT323 for Retro, whose root font size is bumped since VT323 runs small);
  their `@font-face`s only download when a preset uses them.
  `tests/e2e/ui-appearance.spec.ts` saves every preset and checks it's
  server-rendered, leaving a screenshot of each in `test-results/`.
- **Rendering cost.** A full-viewport layer is never filtered or blended for
  nothing: `body::before` (the aurora) is plain gradients with no `filter`, and
  it and `body::after` (the grain, `mix-blend-mode: soft-light`, which forces
  the whole page to be re-blended every frame) are `display: none` through
  `--aurora-display`/`--grain-display` wherever their opacity is 0, since an
  invisible layer still costs its compositing.
- **Tabs** (`tabLayout`: `horizontal` | `vertical`, `src/lib/tab-layout.ts`):
  `TabNav` draws pill tabs above the page, or, beside it, hands its tabs to the
  protected layout through the `SubNav` context (`src/lib/sub-nav.svelte.ts`),
  which renders them as a second `data-slot="app-sidebar"` column next to the
  main one, styled like its items. That column sits after the frame in the DOM
  and is moved by `md:order-*`, so the server renders it on first paint (the
  tabs are registered while the page renders, after the sidebar would have
  been). It only shows while the URL is under one of its tab links, so leaving
  the section drops it whatever the teardown order. Below `md` the pill strip is
  used either way.
- `(protected)/+layout.server.ts`'s shared `load` (same one that fetches
  notifications, see above) now also fetches `UserPreferencesDTO.get(...)` and
  returns `preferences: preferences.toJSON()`, since the sidebar itself, not
  just the Appearance page, needs it on every protected render.

## Simple and advanced UI modes (`src/lib/ui-mode.ts`, `user_preferences.uiMode`, `instance_settings.defaultUiMode`)

Two ways to render the same dashboard: **simple** (homelab click-ops: short
sidebar, templates up front, engineering settings out of sight) and **advanced**
(everything). The mode only changes what's in view: it never forks a page, never
blocks a route, never changes what a service does. Operator-facing list of what
each mode shows: `docs/ui-modes.md`, keep the two in sync.

- **One definition**: `ADVANCED_ONLY` in `src/lib/ui-mode.ts`, a set of stable
  ids. Sidebar entries are keyed by their path (`/registry`), tabs and sections
  by their route under the page (`service/environments/revisions`,
  `settings/ip-bans`), blocks inside a page by `<page>#<block>`
  (`service/networking#published-ports`, `services/new#compute`). Hiding
  something new is one id there plus the `visibleIn` call where it renders;
  `tests/unit/app/ui-mode.test.ts` pins the split.
- **Resolution**: `effectiveUiMode(user, instance)`, the account's choice, else
  the instance default, else `DEFAULT_UI_MODE` (advanced, so an instance that
  never picked keeps everything visible). The `(protected)` root layout load
  returns `uiMode` (effective) and `instanceUiMode`, so every page and layout
  under it reads `data.uiMode`, no extra fetch.
- **Nav, tabs, sections**: `visibleItems(mode, items, pathname)` filters any
  `{ href, id }[]` and always keeps the item the current page sits under
  (`currentHref`, longest matching href, same rule as `section-nav.svelte`), so
  landing on a hidden page directly still highlights where you are. The sidebar
  maps each nav item to `id: item.href`; the section layouts (`environments/`,
  `observability/`, `container/`) give each section an `id`; the service and
  settings tab bars call `visibleIn` per tab (settings also keeps a tab with a
  setup warning). A new section in one of those layouts needs an `id` or
  `visibleItems` won't typecheck. In simple mode the service's Environments &
  Deployments tab links to Source, since its bare Environments section is
  hidden.
- **Page blocks**: a hidden panel that's its own form is `{#if}`'d out, but
  stays when the service already uses it (blocked paths set, published ports, a
  response cache, healthcheck overrides): hiding a setting that's in effect
  would hide why the service behaves the way it does. A field inside a shared
  form goes in `advanced-disclosure.svelte` instead (collapsed in simple mode,
  rendered inline otherwise), never `{#if}`: the form still has to submit it, or
  saving the visible fields would reset the hidden one.
- **Switching**: Profile → Appearance → Interface (`updateUiMode`, "" clears to
  follow the instance), the profile menu's one-click toggle (`setUiMode` remote
  command, allowlisted for read-only accounts in `permissions.ts` since it's a
  personal preference, followed by `refreshAll()`), Settings → General →
  Interface mode (`updateUiMode`, admin) and onboarding's Core step, which sets
  the instance default. `ui-mode-picker.svelte` is the shared radio-card picker
  for all three forms.
- **Simple-only additions**: the Overview's "Deploy an app" strip
  (`SIMPLE_FRONT_PAGE_TEMPLATES`, built-in template ids, posting to the
  templates page's `?/quickDeploy`), and the service Overview's "Roll back to
  the previous version" button (`?/rollback`,
  `RevisionService.findTarget(svc, null)`), shown only when there's a previous
  revision, since Revisions is hidden there.

## Error boundaries (`error-boundary.svelte`)

A render error never blanks more than the piece that broke. `ErrorBoundary` (a
`svelte:boundary` with a retrying alert, or a small inline retry button with
`compact`) wraps: the root layout's children (signed-out pages and the protected
layout's own chrome), every page in the protected frame, every tab's content
inside `TabNav` and every `SectionNav` subtab, the header's search, bell and
profile menu and the sidebar's version badge (`compact`), and each self-loading
panel at the place it's used (host resources, resource usage, replica stats, the
job queue). A new panel that loads its own data gets wrapped the same way where
it's used. Load errors are still `+error.svelte`'s job.

## Mobile shell (below `md`)

Below 768px the protected layout behaves like a native app instead of a shrunk
desktop. `mobile-tab-bar.svelte` is a bottom bar (Home, Services, Deploys,
Alerts with the unread badge from the same remote query the bell polls, Menu),
filtered through `mayVisit`; the header's bell is hidden there since Alerts
replaces it. Menu opens `mobile-drawer.svelte`: a custom bottom sheet (not the
vaul `ui/drawer`), 97% opaque so the page behind doesn't bleed through, that
flies up, scales the app frame behind it, and closes on scrim tap, Escape or a
downward swipe past 100px while its nav is scrolled to the top.

`TabNav` turns a page whose tabs are all routes into a nav-card hub: at the
first tab's bare path (no query string) it shows one card per tab and hides the
page under it, and every other tab gets a "‹ Sections" back row instead of the
strip. The first tab shares the hub's path, so its card links to `?view=tab`;
any query string (pagination too) means "show the page, not the hub".
`NavTab.description` is the card's one-line "what this tab is for", and
`NavTab.summary` its live state, taken only from data the layout already loads
(a count, a last run, a status); every `TabNav` layout sets a description, and a
summary where that data is at hand. A new tab gets both. Tabs driven by
`onSelect` keep the strip. `SectionNav` does the same for subtabs when the
layout passes the page as its children
(`<SectionNav ...>{@render children()}</SectionNav>`), with `hubLabel` naming
its back row ("‹ Observability"); without children (an in-page view switch like
the issue views) it stays a strip. All of it is CSS-switched
(`max-md:`/`md:hidden`), no `MediaQuery`, so SSR renders the right shape with no
flash.
