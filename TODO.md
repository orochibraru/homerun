<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Breadcrumbs of a pull request preview skip its parent service: show the
      service before the preview.

## Medium

- [ ] Monitoring: compare each number with the previous period of the same
      length (+x% from last week/month/year), marked as better or worse.
- [ ] Pull request previews: a checkbox to reuse the parent's environment
      variables with per-preview overrides, and an option to copy the parent's
      volumes into a new preview.
- [ ] A TLS tab in Settings to install an instance-wide certificate, e.g. a
      Cloudflare origin certificate for the base domain.
- [ ] DX pass on spinning Homerun up locally: the compose files and setup steps
      against what runs now (image mirror, registry, worker, Traefik metrics).
- [ ] Templates E2E in CI as a matrix, one job per template, for speed and a
      trace per template.

## Large

- [ ] Dedicated SSH routing, would be useful to SSH into the main Homerun
      machine remotely as well as the agent connected machines, a dedicated page
      through xtermjs would be useful as well. This would especially be nice for
      git self hosters for Gitea, Gitlab and such.
