# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] A tree view on the global `/services` page, like `/stacks/[stackId]`'s
      Services tab. Skipped there for now because that page is paged and sorted,
      and a dependency tree needs the whole unpaged set to draw correctly.

- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.

- [ ] The login wall's "Set Origin under Settings → General first" message
      (service Security tab and its save action) and the "Origin URL" setup
      check name a setting the General tab labels **Dashboard URL**; use that
      label.

- [ ] `install.sh --version=canary` (documented in `docs/api-and-cli.md`)
      downloads from a `canary` release tag that no longer exists; resolve the
      newest `-canary.`/`-nightly.` prerelease instead.

## Medium

- [ ] A per-variable "secret" switch on the service Environment tab, stored with
      the var, that the MCP server (and any other export) always redacts
      whatever its name. Today redaction goes by name pattern plus URL passwords
      and password arguments, which misses a secret under an innocent name
      (`TMDB_API`).

## Large

<!--  -->
