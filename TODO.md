# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

- [ ] **[WIP]** Go worker, multi-agent workflow running. Create a homerun
      worker, in Go. Shares library with the installer, the agent and the CLI.
      Then remove ALL intensive logic from the sveltekit app. The go worker will
      do the heavy lifting, the sveltekit app handles saving stuff in the DB and
      the job queue to send to the worker.

- [ ] Move every remaining Docker call into the Go worker so the SvelteKit app
      becomes a pure control plane: start/stop/restart and status sync as jobs,
      logs, web terminal and host stats streamed from the worker, boot-time core
      services (Traefik, registry, Newt) and self-update run by the worker.
      Starts once the job-type port above lands.

- [ ] Worker should be as verbose as possible.

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
