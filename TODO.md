# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

- [ ] Tag orochibraru/releaser v1.4.0 (the `draft` input and dry-run outputs),
      then re-pin the two `orochibraru/releaser@v1.4.0` lines in
      `.github/workflows/publish.yaml` to its commit SHA (`pinact run`). Until
      then the `pinact` hook and the publish workflow fail.

## Small

- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.

- [ ] Have the worker converge the core services (Traefik, the registry, Newt)
      at its own boot rather than the app triggering it from `hooks.server.ts`.
      The app performs no Docker work either way — it asks the worker — but the
      trigger still lives on the app side, so a worker restarted alone doesn't
      re-assert them.

## Medium

## Large
