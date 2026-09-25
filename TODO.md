# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Swarm start-first rollouts can drop the VIP alias from Docker's DNS
      (Docker 28.5.2): after a redeploy `<slug>` answers SERVFAIL while the
      service name and `tasks.<slug>` still resolve. Hit on `gitea-redis` and
      `aiometadata-dragonfly`. Resolve the alias on the overlay after a swarm
      rollout and re-register (stop-first force update) or fail the deploy.

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
- [ ] Swarm deploys can lose a service's slug alias in Docker's DNS when the old
      and new task overlap (moby's alias-removal race): only the full service
      name still resolves, and every link to the slug breaks (AIOMetadata →
      `aiometadata-dragonfly`, for 8 hours). After a swarm deploy, check from
      the worker that the slug resolves on the overlay and force-update the
      service once if it doesn't.

## Large

<!--  -->
