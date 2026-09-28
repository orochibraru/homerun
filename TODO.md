<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Run the Cloudflare DNS automation against a real account and fix what
      breaks. Pangolin's half ran live against `homelab` (site
      `homerun-live-test`, `chibre.space`) and passes; Cloudflare needs a token.

## Medium

- [ ] Release channels: exercise against a real git provider (a tag push
      deploying stable, a branch push deploying canary); everything else about
      them is built and checked in a browser.

- [ ] Preview "unhealthy while healthy" with several domains (sergios.fr PR #4):
      its current revision reads `healthy` and both hostnames answer, so it
      didn't reproduce; need where the Unhealthy label showed (revision, uptime,
      overview) next time it happens.

## Large

- [ ] Manage DNS from the main instance, Pangolin and cloudflare are only used
      via API. We should be able to register domains and connect them through
      Homerun. To that end let's also be able to connect to DNS providers such
      as namecheap, Cloudflare, Hetzner and all the majors.
- [ ] Autoscale feature, register a Homerun agent on any barebones server and it
      becomes a build server or a swarm node.
- [ ] Dedicated SSH routing, would be useful to SSH into the main Homerun
      machine remotely as well as the agent connected machines, a dedicated page
      through xtermjs would be useful as well. This would especially be nice for
      git self hosters for Gitea, Gitlab and such.
