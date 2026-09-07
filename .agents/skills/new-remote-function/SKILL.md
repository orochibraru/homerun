---
name: new-remote-function
description:
  Workflow for adding a query/command under src/lib/remote/*.remote.ts
  (SvelteKit remote functions): requireUser() auth, zod-validated args, the
  refresh-in-place vs. one-shot consumption split, and which data belongs here
  vs. in a route's load. Use when adding a panel that loads behind a skeleton,
  a poll, a picker's on-demand lookup, or a small mutation the bell/a
  self-loading component fires — not for data a page's own correctness
  depends on.
user-invocable: true
---

# new-remote-function

## 1. Does this belong in a remote function at all?

Only data whose absence for a few hundred milliseconds is a skeleton, not a
broken page. The signed-in user, their role, instance settings, and any entity
list a route renders stay in `load`. If what you're adding is closer to "the
page can't render meaningfully without this," it's a `load`, not a remote
function.

## 2. File and auth

New or existing `src/lib/remote/<name>.remote.ts`. Every `query`/`command`
starts with `requireUser()` (`$lib/server/remote-auth`) — a remote function is
its own endpoint, it does **not** inherit `(protected)`'s layout guard:

```ts
export const getThing = query(async (): Promise<Thing> => {
  const user = requireUser();
  ...
});
```

Admin-only data needs its own `locals.isAdmin`-equivalent check on top —
`requireUser()` alone doesn't gate that.

## 3. Validate arguments, don't cast

Pass a zod schema as the function's first argument, same posture as the REST
API's `$lib/server/validation/api.ts`:

```ts
export const listThings = query(z.string(), async (id) => {...});
export const doThing = command(z.object({ id: z.string() }), async ({ id }) => {...});
```

Never reach for `"unchecked"`.

## 4. Query vs. command

`query` for a read, `command` for a mutation. A command that changes data a
query already serves should re-`.refresh()` that query at the end so the
mutation's own response carries the updated feed — see
`notifications.remote.ts`'s `markNotificationRead` calling
`getNotifications().refresh()` after the write, rather than the caller doing a
separate `refreshAll()`.

## 5. Pick the right consumption pattern — this is the part that's easy to get wrong

A `RemoteQuery` is a **stable promise**. `{#await someQuery}` renders once and
will **not** re-render when `.refresh()` lands, because the awaited expression
never changes identity.

- **Refreshes in place** (a poll, a command's single-flight update): read the
  reactive accessors directly, `query.ready` / `query.current` / `query.error`,
  with the pending branch rendering `$lib/components/skeleton.svelte`.
  Reference: `host-resources.svelte` (`onMount` + `setInterval` calling
  `stats.refresh()`), `job-queue-panel.svelte`, `notification-bell.svelte`.
- **One-shot, user-triggered lookup** (a button click, a picker's on-demand
  fetch): assign a fresh promise to `$state` and `{#await}` that, so the block
  re-runs per invocation. Reference: `git-repo-picker.svelte`'s "List repos"
  click assigning `reposPromise = listProviderRepos(providerId)`.

Don't `{#await}` a bare `query()` call directly if it needs to reflect a later
`.refresh()` — that's the bug this split exists to prevent.

## 6. Toast exception

A remote-query-backed panel is one of the documented exceptions to "every async
action gets `toast.promise`" — it renders its own inline skeleton/spinner and
reports failure inline (`stats.error`, an `{:catch}` block), it doesn't narrate
itself through a toast. A form that mutates state via a deliberate user
submission still goes through `enhanceToast`, not a command.

## 7. Finish

Run the `check-repo` skill.
