# Services

A **service** is one deployed container. Create one from `Services → New`,
either standalone or pre-filled from a [stack](stacks.md) or
[template](templates.md) via `?stackId=`/`?templateId=`. The wizard's primary
button, **Create and Deploy**, persists the config and immediately deploys it,
landing you on the new service's Overview tab; **Create service**, the secondary
button, just persists the config, the same as before, deploy later from the
Overview tab yourself.

## The services list

`Services` has a search box (matches name, image, and domain) plus Status/ Stack
filters, and a list/card view toggle that remembers your choice per browser;
both the search and filters are applied on the server, so they reach every
service you own, not just whichever page happens to be on screen. Once you have
more than a page's worth, a pager at the bottom shows "26–50 of 60" and lets you
step through the rest. Check one or more services (a "select all" scopes to
whatever's on the **current page**, paginating or changing the search/filters
clears your selection) to bring up a bottom bar with bulk
Start/Stop/Restart/Delete: bulk actions run against every selected service and
report back which ones succeeded, so one service with no container yet doesn't
block the rest. Bulk delete, and the single-row delete on this page and the
danger-zone delete on a service's own Settings tab, all require typing a
confirmation phrase (the service's name for a single delete, `delete N services`
for a bulk one) before the button unlocks, an irreversible action gets a real
"are you sure" rather than a single click. A delete removes the container or
swarm service first: one that's already gone is fine, but if Docker fails to
remove it, the service is kept and the error says why. The Settings tab's delete
then offers **Delete anyway**, which removes only Homerun's record (the REST
API's equivalent is `DELETE /api/v1/services/:id?force=true`).

## Settings

Name, slug, restart policy, which stack the service belongs to, the
[scheduled redeploy](scheduling.md#scheduled-redeploy), the pull policy, whether
its image is [scanned](image-scanning.md),
[auto-rollback](revisions-and-rollback.md), and a danger-zone delete
(typed-confirm, see [The services list](#the-services-list)).

**Pull policy** decides whether a deploy pulls the image: **Always** (the
default, and the only way a moving tag like `:latest` picks up a new build),
**If missing** (only when the image isn't on the host yet, faster redeploys but
a moving tag goes stale), or **Never** (for an image built or loaded onto the
host by hand, the deploy fails if it isn't there).

**Healthcheck command** overrides the image's own Docker healthcheck with a
shell command run inside the container every 30s (exit 0 = healthy). When a
service has one, its uptime probe reports the healthcheck instead of knocking on
the container port, which is what a portless container needs. It is also the
service's [readiness check](deploying.md): a new container or swarm task gets no
traffic until it passes. Takes effect on the next deploy.

**Save as template** is here too: it snapshots this service's current image,
tag, port, env vars, resource limits, healthcheck and
[runtime options](runtime-and-compute.md#runtime) into a reusable template of
your own, which then behaves exactly like a built-in one, including being
linkable as a companion to another template. See [Templates](templates.md).

## Everything else a service does

Each part of a service has its own page:

- [Deploy source and build methods](deploy-source-and-builds.md)
- [Deploy on push](deploy-on-push.md),
  [pull request previews](pull-request-previews.md) and
  [required status checks](status-checks.md)
- [Deploying](deploying.md) and
  [revisions and rollback](revisions-and-rollback.md)
- [Image scanning](image-scanning.md)
- [Env vars](env-vars.md) and [storage volumes](storage-volumes.md)
- [Networking](networking.md), [DNS automation](dns-automation.md) and the
  [per-app login wall](login-wall.md)
- [Runtime and compute](runtime-and-compute.md) and [swarm mode](swarm-mode.md)
- [Observability](observability.md): uptime, logs, errors and the terminal
- [Scheduling and the job queue](scheduling.md)
