# Stacks & templates

## Stacks

A stack groups services together and gives them a shared, private Docker
network, member services can reach each other by plain slug (`http://api:8080`),
separate from the shared `homerun` every service also joins for Traefik routing.
A stack also prefixes its member services' public subdomains:
`<stackSlug>-<slug>.<baseDomain>`.

Every stack gets its network created alongside the stack row and removed on
delete. Deleting a stack (`cascadeDelete`) is the real "delete a stack"
operation, it stops and removes every member container, deletes their deployment
history and service rows, deletes the stack row itself, and finally removes the
stack's Docker network, in that order. A container or swarm service Docker
reports as already gone counts as removed; if one can't be removed for any other
reason (the daemon is unreachable, say), nothing is deleted and the page offers
**Delete anyway**, which drops the records and leaves that workload for you to
clean up by hand.

Assign a service to a stack on the New Service wizard, or move it later from the
service's Settings tab. A stack's page lists its services with what each one is
using right now; its **Settings** tab renames it (name, slug, description) and
deletes it.

`/stacks` has a search box, a list/card view toggle, and a pager once you have
more than a page's worth, same as the
[services list](services.md#the-services-list) and searched/paginated
server-side the same way. Deleting a stack from its own page requires typing the
stack's name to confirm, since it also deletes every service inside it.

## Templates

A template is a saved service config (image, tag, container port, env vars, CPU/
memory, and the [runtime options](services.md#runtime): entrypoint, command,
labels, env files, added capabilities, devices and privileged mode) you can
deploy from repeatedly without re-entering everything. Two kinds:

- **Built-in**, a catalog of ~70 common self-hosted apps, media (Jellyfin,
  Navidrome, the *arr stack, qBittorrent), databases and caches (PostgreSQL,
  MySQL, MongoDB, Redis), networking (Pi-hole, AdGuard Home, Nginx Proxy
  Manager), monitoring (Uptime Kuma, Grafana, Gatus, Healthchecks), dashboards
  (Homepage, Dashy, Homarr, Portainer), productivity (Vaultwarden, Trilium,
  Wiki.js, Vikunja, Excalidraw), and more. Seeded on every boot (idempotent),
  immutable, available to every account. Each carries its real app logo, bundled
  with Homerun rather than hotlinked, so the gallery renders with no outbound
  internet; an app with no official logo falls back to a colored icon for its
  category.
- **Custom**, save any service's current config as a template from its Settings
  tab, or build one from scratch under `Templates → New`, whose **Runtime**
  section takes the same fields as a service's Runtime tab plus env files. Owned
  by the account that created it and visible only to them.

### Host access

Privileged mode, devices, added capabilities and env files give a container
access to the host, so they stay admin-only on templates too. Only an admin can
set them on `Templates → New`, and only an admin can deploy a template that
carries any of them, whether through **Quick Deploy** or **Configure**. That
includes a template whose linked companion carries them: the whole deploy is
refused with a message naming each template that needs host access, before
anything is created. Non-admins see the same warning on the template's details
page and in the New Service wizard, and Quick Deploy is disabled there.

### The gallery

`Templates` has the same toolbar as every other list page, a search box
(matching name, description and image) and a category filter built from the
categories actually present, plus a list/card view toggle that defaults to
**card** here. Built-in and custom templates page independently, 24 at a time
each, so a large custom collection doesn't push the built-in catalog off the
first screen.

Every card, and the template's own details page, offers two actions:

- **Quick Deploy** creates the service straight from the template's defaults
  (name and slug generated for you) and deploys it immediately, no wizard. From
  the gallery it stays put and toasts a "View" link when it's done, so you can
  quick-deploy several apps back to back; from a details page it takes you to
  the new service.
- **Configure** opens the New Service wizard pre-filled from the template
  (`?templateId=`, plus `?stackId=` if you arrived from a stack) so you can
  adjust anything before creating it. Nothing is deployed until you submit.

### The details page

Clicking a template opens its own page: the full description, container port,
CPU/memory defaults, every env var it sets, any runtime overrides, and links to
the project's source repository and website where it has them. When the source
link points at GitHub, Homerun also pulls in the repo's star count, last push,
latest release tag and rendered README, so you can read what an app actually is
without leaving the dashboard. That's fetched unauthenticated and streamed in
after the rest of the page, so GitHub being slow, rate-limiting you (60 requests
an hour per IP), or down just means the panel doesn't render.

### Linked containers

A template can pull its companions along with it. WordPress ships linked to
MySQL, Umami and Miniflux to PostgreSQL, Paperless-ngx to Redis, and you can
link your own the same way from the "Linked containers" section on
`Templates → New`: tick any other template, give it an alias (defaults to a slug
of its name), and deploying the primary deploys the companions too.

Env vars on the primary template can then reference a companion:

- `{{db}}` resolves to that companion's generated slug, which is its hostname on
  the shared network, so `DATABASE_HOST={{db}}` just works.
- `{{db.POSTGRES_PASSWORD}}` resolves to the companion's own value for that env
  var, so the primary and the database agree on a password without you typing it
  twice.

An alias that doesn't resolve is left in the deployed env var verbatim rather
than silently blanked, so a typo is visible instead of mysterious.

Deploying a linked template creates a stack for the linked services if the
service doesn't already belong to one (so it shows up grouped), gives each
companion a deterministic slug (`<primary>-<alias>`), and creates them **not**
DNS-resolvable by default, a database or cache usually doesn't want a public
subdomain. Companions are queued ahead of the primary, and if one fails the
primary is cancelled rather than started against a missing dependency (see
[the job queue](services.md#the-job-queue)).

Links go exactly one level deep: you can't link to a template that itself has
links. That's deliberate, it keeps `{{alias}}` resolution to a single pass with
no cycles to detect.
