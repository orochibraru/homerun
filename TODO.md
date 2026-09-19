# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

- [ ] Move every remaining Docker call into the Go worker so the SvelteKit app
      becomes a pure control plane: start/stop/restart and status sync as jobs,
      logs, web terminal and host stats streamed from the worker, boot-time core
      services (Traefik, registry, Newt) and self-update run by the worker.

- [ ] Worker should be as verbose as possible.

## Small

- [ ] Delete the dead code outside the worker port that a reference sweep found:
      `nav.ts`, `GRADIENTS`/`GRADIENTS_DARKER`, `getHash`, `currentRevision`,
      `okResponse`, `ServiceHealth`, `YamlConfig`, `LogFormats`, the unused
      `ui/field` primitives, and test-only `Logger.trace`, `linkedMethods`,
      `listEntries` (Coolify/Dokploy), `defaultsFor`.
- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.

## Medium

## Large
