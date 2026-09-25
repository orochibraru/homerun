# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Run Cloudflare and Pangolin DNS automation against real accounts and fix
      what breaks. Offline audit against the docs and Pangolin 1.23.0 source is
      done, a live run needs a Cloudflare token and a permission rule for DNS
      changes.

## Medium

- [ ] Swarm service logs (Observability tab, `homerun services logs`) mix the
      output of every task generation, dead ones included, in no reliable order,
      so a crash from an old revision reads like the current task's. Show only
      the current tasks' logs, or at least timestamp and label each line with
      its task.
- [ ] Setup diagnostics: check the running Traefik against what the settings
      expect (the Souin plugin when the HTTP cache is on, the swarm provider in
      swarm mode, the ACME email) and flag the drift with a one-click re-apply.
      A `docker compose up --force-recreate` silently dropped the plugin and
      404'd every cached service; the worker-boot re-assert fixes the common
      case, this catches the rest.

## Large

## Done

- [x] The post-deploy revision health watch only looks at container state
      (restarts, Docker healthcheck), so an image with no HEALTHCHECK that stays
      up but never gets ready (AIOMetadata stuck waiting on Redis, answering 503
      everywhere) is marked healthy. Also probe the service over HTTP and treat
      a 5xx as unhealthy, like the uptime probe now does.
