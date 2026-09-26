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

- [ ] Error tracking: upload source maps so minified browser JavaScript maps
      back to its source (today its frames show as sent).
