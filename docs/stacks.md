# Stacks

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
