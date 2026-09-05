# API & CLI

## REST API

`/api/v1/*` is a thin, typed JSON wrapper over the same DTO layer the dashboard
itself is built on: not a separate abstraction. Every route checks its own auth
independently (a cookie session, or `x-api-key`/`Authorization: Bearer <key>`
from your profile page), so the same handlers serve the dashboard's own requests
and external API-key clients alike.

- `GET/POST /api/v1/services`, `GET/PATCH/DELETE /api/v1/services/:id`
- `POST /api/v1/services/:id/{deploy,start,stop,restart}`: `deploy` awaits the
  full pull-or-build → create → start pipeline and returns once it's done (no
  separate polling endpoint for API clients: that's dashboard-only, for its own
  progress UI)
- `GET/POST /api/v1/projects`, `GET/POST /api/v1/templates`
- `GET /api/v1/system-stats`: host CPU/RAM/disk/GPU

The three list `GET`s (`services`, `projects`, `templates`) are paginated:
`?page=`, `?perPage=` (default 100, max 100), and `?q=` for a case-insensitive
search. The response body stays a plain JSON array, on purpose, so an existing
integration keeps working unchanged; the total row count and the page/size you
got back come in the `x-total-count`/`x-page`/`x-per-page` response headers
instead. Both the OpenAPI spec and the CLI (below) document these the same way.

## OpenAPI spec & Swagger UI

`GET /api/v1/openapi.json` is a real, generated OpenAPI 3.1 document:
public/unauthenticated (it describes shapes, not data; every route it documents
still enforces its own auth). Request bodies come straight from the zod schemas
that validate each request at runtime, so the spec can't silently drift from
what the API actually accepts.

The **API Docs** page in the dashboard (own nav item) renders that spec with a
self-hosted Swagger UI: no outbound internet needed to view it. "Try it out"
from that page makes its own unauthenticated `fetch` calls (it doesn't share
your dashboard session), so paste an API key there to actually exercise a
request.

## CLI

A typed CLI (`packages/cli/`) built on
[`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) against the spec above:
its types are generated straight from a running instance's real
`/api/v1/openapi.json`, so the client is checked against the actual API shape,
not a hand-maintained guess.

Install it with one command: it detects your arch, downloads the matching
release binary, and drops it at `/usr/local/bin/homerun` (Linux only, no
Bun/build step needed):

```sh
curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/cli/install.sh | bash
```

```sh
HOMERUN_BASE_URL=https://your-instance.example.com \
HOMERUN_API_KEY=<a key from your profile page> \
homerun services list
```

Or, working on the CLI itself, from the repo root:
`bun install && bun run packages/cli/index.ts services list`
(`bun run scripts/build-packages.ts <amd64|arm64>` compiles it the same way CI
does). See [`packages/cli/README.md`](../packages/cli/README.md).

```bash
homerun services list [--json]
homerun services get <id>
homerun services deploy <id>
homerun services start <id>
homerun services stop <id>
homerun services restart <id>
homerun projects list [--json]
homerun templates list [--json]
```

No `create`/`update`/`delete` yet. Every `list` command above also accepts
`--page`, `--per-page` (default 100, max 100) and `--search <term>` for a large
result set; if what's printed is only part of the total, a footer line tells you
so (`Showing 10 of 60 (page 1 of 6). Use --page/--per-page for the rest.`)
rather than letting a truncated table look complete. See
[`packages/cli/README.md`](../packages/cli/README.md) for the full reference,
including how to regenerate the generated types after an API change.
