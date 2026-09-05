# Projects & templates

## Projects

A project groups services together and gives them a shared, private Docker
network, member services can reach each other by plain slug (`http://api:8080`),
separate from the shared `homerun` every service also joins for Traefik routing.
A project also prefixes its member services' public subdomains:
`<projectSlug>-<slug>.<baseDomain>`.

Every project gets its network created alongside the project row and removed on
delete. Deleting a project (`cascadeDelete`) is the real "delete a project"
operation, it stops and removes every member container, deletes their deployment
history and service rows, deletes the project row itself, and finally removes
the project's Docker network, in that order.

Assign a service to a project on the New Service wizard, or move it later from
the service's Settings tab.

`/projects` has a search box, a list/card view toggle, and a pager once you have
more than a page's worth, same as the
[services list](services.md#the-services-list) and searched/paginated
server-side the same way. Deleting a project from its own page requires typing
the project's name to confirm, since it also deletes every service inside it.

## Templates

A template is a saved service config (image/tag/port/env vars/etc.) you can
deploy from repeatedly without re-entering everything. Two kinds:

- **Built-in**, Redis, Postgres, MySQL, MongoDB, Adminer, Uptime Kuma, n8n,
  Vaultwarden. Seeded on every boot (idempotent), immutable, available to every
  user.
- **Custom**, save any service's current config as a template from its Settings
  tab. Owned by the user who created it; visible only to them.

Deploying from a template pre-fills the New Service form (`?templateId=`), you
still review and can adjust anything before creating the service, and it still
doesn't deploy automatically (same "create ≠ deploy" split as every other
service).

`Templates` has the same search-and-filters bar as every other list page
(matches name/description/image, plus a category filter) and a list/card view
toggle, defaulting to card view here. The built-in and your own custom templates
page independently, 24 at a time each, so a large custom collection doesn't push
the built-in catalog off the first screen.
