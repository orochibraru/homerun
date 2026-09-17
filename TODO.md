# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Swarm rollouts: close the ~4s gap from Traefik's 15s swarm poll when an
      old task stops (lower `refreshSeconds`, or verify `lbswarm`).
- [ ] Standalone rollouts: a Traefik retry middleware so requests racing the old
      container's removal don't fail.
- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.

## Medium

## Large
