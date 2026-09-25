# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.

## Medium

- [ ] Volume backups: clicking a backup run opens its logs, like a deployment's
      page.

## Large

- [ ] Zero-downtime self-updates: run the app and the worker as swarm services
      with start-first updates and rollback on a failed healthcheck, so a broken
      canary rolls itself back and the instance stays usable. Touches the
      installer's compose files and the self-update path.
