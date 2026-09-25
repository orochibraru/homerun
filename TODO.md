# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.

- [ ] The auto-detected forward-auth URL (`setDetectedAuthCheckUrl` in
      `hooks.server.ts`) is only resolved at app boot, so an app that boots
      before the worker is up never gets it until its next restart.

## Medium

- [ ] Deploy Cancel only stops the app-side wait (status checks). A queued job
      that hasn't started yet still runs, and a Go-side build/pull keeps going
      and overwrites the `failed` status when it finishes : the worker needs to
      poll the deployment row (or take a cancel call) and kill the build.

## Large

- [ ] Browse and edit files inside a volume (or a host path) from the UI, for
      config files imported from Dokploy's file mounts: a Files tab on a volume
      backed by a short-lived helper container through the worker (list, read,
      write, upload), and/or a one-click "Open in code-server" that deploys the
      code-server template with the volume mounted at /config.
