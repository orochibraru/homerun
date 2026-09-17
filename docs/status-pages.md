# Status pages

**Status Page** in the sidebar builds an uptime page out of your services'
[uptime probes](observability.md#uptime). Each page has a name, a slug and an
optional description, and covers one of three sets: **every service**, **one
stack**, or **services you pick**. Its page in the dashboard shows each
service's recent heartbeats and uptime percentage.

Tick **Publish this page** to make it readable without signing in at
`/status/<slug>` on your dashboard's address; the page shows the copyable link.
A public page shows only service names, up/down, and uptime over the last 40
checks from the network probe: never images, ports, hostnames or probe errors.
An unpublished page is a 404 there.
