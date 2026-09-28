# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Run the Cloudflare DNS automation against a real account and fix what
      breaks. Pangolin's half ran live against `homelab` (site
      `homerun-live-test`, `chibre.space`) and passes; Cloudflare needs a token.

## Medium

- [ ] Group scheduled-redeploy notifications: every `cron`-triggered deploy
      fires its own bell entry and channel message (`DeploymentService`'s
      `#notifySuccess` and failure path), so a shared schedule floods both.
      Buffer `cron` outcomes, flush after ~90s quiet (10 min cap) as one success
      digest (`update.succeeded`) and one failure digest (`update.failed`, each
      error listed); a batch of one keeps today's single-service message.

- [ ] Run-as-user (or volume ownership) for services and templates: Vikunja runs
      as uid 1000 from a `scratch` image, and a fresh named volume at
      `/app/vikunja/files` comes up root-owned, so it can't write its files or
      SQLite database. Add the option, set it on
      `templates/productivity/vikunja.json` and drop its entry from `SKIP` in
      `tests/e2e/templates/deploy.spec.ts`.

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
