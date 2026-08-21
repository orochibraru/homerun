# Projects & templates

## Projects

A project groups services together and gives them a shared, private Docker
network, member services can reach each other by plain slug (`http://api:8080`),
separate from the shared `homerun-network` every service also joins for Traefik
routing. A project also prefixes its member services' public subdomains:
`<projectSlug>-<slug>.<baseDomain>`.

Every project gets its network created alongside the project row and removed on
delete. Deleting a project (`cascadeDelete`) is the real "delete a project"
operation, it stops and removes every member container, deletes their deployment
history and service rows, deletes the project row itself, and finally removes
the project's Docker network, in that order.

Assign a service to a project on the New Service wizard, or move it later from
the service's Settings tab.

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
