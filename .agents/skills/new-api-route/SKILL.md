---
name: new-api-route
description:
  Workflow for adding or changing a route under src/routes/api/v1/, this
  repo's REST API: the auth check every handler needs since it sits outside
  (protected)'s guard, the separate zod body schema in
  $lib/server/validation/api.ts, keeping $lib/openapi/registry.ts and
  schemas.ts in sync by hand, and regenerating packages/cli/'s OpenAPI-derived
  types afterward. Use whenever a route under src/routes/api/v1/ is added,
  removed, or has its request/response shape changed.
user-invocable: true
---

# new-api-route

`src/routes/api/v1/` is outside `(protected)/` — that group's guard is a page
`load` redirect, wrong for a JSON API that should 401 instead. Every step here
matters because nothing enforces they stay in sync at compile time; the CLI's
generated types are a checked-in snapshot that goes stale silently if you skip
step 5.

## 1. The route handler

Every `GET`/`POST`/etc. starts with its own explicit check, `locals.user` is
populated for both cookie sessions and `x-api-key`/`Bearer` requests by
`hooks.server.ts`:

```ts
export const GET = async ({ locals, url }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  ...
};
```

Call `allowLongRequest(platform)` as the first statement if the operation can
legitimately outlast Bun's 10s idle timeout (deploy/stop/restart/delete-style
work) — see the Long-running requests section of CLAUDE.md. Go through the DTO
layer, never raw Drizzle, same rule as page routes.

## 2. Request body schema

A JSON-body zod schema in `$lib/server/validation/api.ts`, **separate** from any
FormData-shaped schema in `$lib/server/validation/service.ts` — that one's
checkbox/`envKey[]`/`envValue[]` preprocessing is form-specific and doesn't
belong here. `safeParse` the body, return 400 with `result.error.flatten()` on
failure, same shape as `projects/+server.ts`'s `POST`.

## 3. List endpoints: pagination, not an in-memory scan

If this is a `GET` returning a collection, use
`parseApiListQuery(url)`/`jsonPage(items, meta)` from
`$lib/server/api-pagination.ts` — default 100/page, max 100, `page`/`q` query
params — over a paged DTO finder (`listXPaged`), not the unpaged `list`. The
response body stays a plain array; total/page/per-page ride in
`x-total-count`/`x-page`/`x-per-page` headers, don't grow the body into an
envelope.

## 4. Response shape

Every response is a DTO's `.toJSON()`, the raw row — there's no runtime-
validated response schema to generate from (that was tried via `drizzle-zod` and
abandoned, see CLAUDE.md's OpenAPI section for why). If this is a new entity or
a new field, **hand-mirror** it into `$lib/openapi/schemas.ts` to match,
including any `*Enc` ciphertext column with a note rather than omitting it — the
spec should describe what's actually returned.

## 5. Register the route in the OpenAPI doc

`$lib/openapi/registry.ts` is hand-maintained, there's no route metadata
anywhere else to generate this from. Add/update an entry: `method`, `path`,
`tags`, `summary`, `pathParams`/`queryParams` (reuse the shared
`listQueryParams` array for a paginated list route), `requestBody` (the zod
schema from step 2), `responses` (status → `{description, schema}`, referencing
`schemas.ts`).

## 6. Regenerate

```bash
bun run gen
```

Regenerates `openapi.json`, `packages/cli/generated/openapi-types.ts`, and
`homerun.schema.json` from the running spec. Run this after any shape change —
`openapi-fetch` (what `packages/cli/` is built on) has no way to detect a
stale-spec mismatch at compile time, this is the only thing that catches it.

## 7. CLI command (only if this route should be user-facing there)

Not every API route needs a CLI command. If it does, add it to
`packages/cli/commands.ts` following the existing `services`/`projects`/
`templates` pattern; a `list` command should thread `--page`/`--per-page`/
`--search` through the same way the existing ones do.

## 8. Finish

Run `check-repo`. If `packages/cli/` was touched, use the `subproject-sync`
agent to confirm the regenerated types and the sub-project's own typecheck are
both clean.
