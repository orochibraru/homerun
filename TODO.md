# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.

## Medium

- [ ] Swarm deploys can lose a service's slug alias in Docker's DNS when the old
      and new task overlap (moby's alias-removal race): only the full service
      name still resolves, and every link to the slug breaks (AIOMetadata →
      `aiometadata-dragonfly`, for 8 hours). After a swarm deploy, check from
      the worker that the slug resolves on the overlay and force-update the
      service once if it doesn't.

## Large

<!--  -->
