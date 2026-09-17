# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.
- [ ] Warn when the dashboard is reached on a different origin than `ORIGIN`:
      SvelteKit then refuses every remote command with a bare 403 before any
      hook runs, so nothing is logged (an IP `ORIGIN` from the installer plus a
      Pangolin/Cloudflare dashboard domain set later hits exactly this).

## Medium

## Large
