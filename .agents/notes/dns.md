# DNS automation (Cloudflare, Pangolin)

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## DNS automation: Cloudflare and Pangolin (`src/lib/services/cloudflare.service.ts`, `src/lib/services/pangolin.service.ts`)

The DNS-provider automation gap this doc used to list under Planned features is
closed: two independent, optional integrations, configured on `/settings`, both
DB-backed on `instance_settings`, both unset by default (inert until
configured), and both can be turned on simultaneously (they run independently).
Both are plain classes with static methods that re-read `InstanceSettingsDTO` on
every call rather than caching, the admin can change credentials mid-session and
syncs are infrequent (once per deploy), same reasoning as `GitProviderService`.
Both fire from the same spot, `deploy.service.ts`'s `syncAutoDns`, right after a
successful **local** deploy with `dnsResolvable` set, for **every** hostname the
service answers on (`<slug>.<baseDomain>` and its `customDomain`, which used not
to be synced at all). Neither can fail the deploy.

**They are no longer fire-and-forget, and that was the whole bug behind
"Pangolin is configured and nothing gets created".** Both `syncDnsRecord`s
caught their own failures into a `logger.warn` and returned `void`, so a
misconfiguration was indistinguishable from a working setup. Every entry point
now returns a `DnsSyncResult` (`$lib/services/dns-result.ts`,
`{provider, ok, detail}`, `null` when that provider isn't configured);
`dns.service.ts`'s `syncDns`/`deleteDns` take an **array** of hostnames and
return every provider's verdict, and `syncAutoDns` awaits that and appends each
one to the deployment's own log
(`DNS (pangolin): created app.example.com -> tunnel:80`, or
`DNS failed (pangolin): no registered Pangolin domain covers …`). The user sees
it on the Overview tab's deploy log where they're already looking, instead of in
a server log line nobody reads.

- **`CloudflareService`**: for instances that own DNS on Cloudflare directly.
  `syncDnsRecord(hostname, target)` upserts a CNAME (`<slug>.<baseDomain>` →
  `baseDomain`) via the Cloudflare v4 REST API; `deleteDnsRecord(hostname)`
  removes it on service delete; `verifyZoneAccess(token, zoneId)` backs the
  Settings page's "Test connection" button. Config: `instanceSettings`'s
  `cloudflareApiTokenEnc` (AES-256-GCM, same scheme as every other `*Enc`
  column) + `cloudflareZoneId`.
- **`PangolinService`**: for instances fronted by a self-hosted
  [Pangolin](https://github.com/fosrl/pangolin) tunnel/reverse-proxy manager
  instead of owning DNS directly. `syncDnsRecord(hostname)` creates a Pangolin
  **Resource** (a subdomain under one of the org's already-registered Pangolin
  domains matching the hostname) plus a **Target** pointing at this host's own
  Traefik entrypoint through the configured "main site"'s tunnel;
  `deleteDnsRecord(hostname)` removes the Resource;
  `verifyConnection({baseUrl, token, orgId, siteName, baseDomain})` backs its
  own "Test connection" button. Config:
  `pangolinApiBaseUrl`/`pangolinApiTokenEnc`/`pangolinOrgId`/`pangolinMainSiteName`
  (all four required to activate) + optional `pangolinTargetPort` (defaults to
  80, Pangolin terminates public TLS itself). Both services use plain
  hand-rolled `fetch` calls rather than an `openapi-fetch` client, same posture
  as `GitProviderService`.

**The Target is `https` against 443, and that is what fixed "routes are created
but we hit a 404".** Every router Homerun writes lives on
`config.traefik.entrypoint` (`websecure`) with `tls=true`, so a Target pointing
at port 80 reached a Traefik entrypoint with **no matching router** and Traefik
answered its own 404 — the tunnel was working, the request just landed nowhere.
`targetScheme(port)` maps 80 to `http` and everything else to `https` (`method`
is a free-form nullable string in the Integration API's own schema), and
`pangolinTargetPort` now defaults to **443**. TLS is therefore terminated twice
on purpose: Pangolin for the public connection, Traefik again for the hop from
the tunnel to the container. With DNS pointing at Pangolin rather than this
host, Traefik's own HTTP-01 challenge can't complete, so that inner certificate
is usually its self-signed default — which is fine, nothing verifies it, but
it's why the inner hop is encrypted rather than trusted. The one remaining
assumption is `ip: "localhost"`, which is only right when the newt tunnel runs
on this host with host networking (see `TODO.md`).

**Every resource Homerun creates has Pangolin's own SSO gate turned off, and
that is what fixed "the route exists, the tunnel is up, and the service is still
unreachable".** `resources.sso` defaults to **true** in Pangolin, and
`PUT /org/{orgId}/resource` is a `strictObject` with no `sso` field, so a
created resource is gated and nothing in the create call can say otherwise: a
browser got a 302 to `pangolin.example.com/auth/resource/…` and an API client a
bare `401 Unauthorized`, for every service the instance published.
`setResourceSso` therefore follows every create with `POST /resource/{id}`
`{"sso": false}`, **and does the same on the already-exists path**, so
redeploying a service heals a resource created before this (there's no other way
to reach the ones already made — the exists check returns early). A failed SSO
update is reported as a failed sync rather than a success, since a gated route
is exactly as unreachable as a missing one. Access control for a deployed
service belongs to this app's own per-service login wall (see `auth.md`), not to
a second, invisible gate at the edge. **Diagnosed against a real instance**, not
from the docs: Traefik on the host answered `200` for
`curl -k -H "Host: <slug>.<domain>" https://127.0.0.1` while the public hostname
answered `401`, with the target already correct (`localhost:443`,
`method=https`, site online).

Two failure modes live **outside** this client and look identical from a
browser, worth checking before touching code again: a Pangolin domain with
`preferWildcardCert: true` and no wildcard actually issued serves Pangolin's
Traefik default self-signed certificate for every subdomain (the apex keeps its
real one, so "the dashboard works and the services don't" is the tell), and an
instance whose generated `compose.yaml` predates the `DASHBOARD_DOMAIN` router
has no Traefik labels on its own `app` service at all.

**Pangolin's OpenAPI document is fetchable after all**, contrary to what this
section used to say (a "the OAS is broken, the types are guesses" note inherited
from the sibling `dokploy-to-pangolin` project):
`GET https://api.pangolin.net/v1/openapi.json` serves the real 3.1 document, and
`/v1/docs` is just a Swagger UI widget over it. Every path and request body this
client sends is now checked against that document plus `fosrl/pangolin`'s own
route source. Three things it settled, all of which matter:

- **The base URL is the Integration API, not the dashboard.** It's a separate
  server (port 3003 by default) that a self-hosted instance only exposes once
  it's enabled, and its base path ends in `/v1`. The Settings placeholder used
  to say `https://pangolin.example.com/api/v1`, which is the cookie-authed
  dashboard API and rejects an API key. `request()` now names that case
  specifically when a response body is HTML rather than JSON.
- **Every list endpoint is paginated, and `/sites` and `/resources` default to
  20 per page.** The old client read page one and stopped, so `findMainSite`
  silently missed a site and the already-exists check silently missed a resource
  on any org bigger than that. `listAll` now follows `pagination.total`
  (recursively, since this repo's `noAwaitInLoops` rule forbids the obvious
  loop). Note the two parameter spellings: `/sites` and `/resources` page with
  1-based `page` + `pageSize`, `/domains` with `offset` + `limit`.
- **Resource creation bodies are `z.strictObject`**, so an unknown field is a
  400, not an ignored key. `http: true` + `protocol: "tcp"` are deprecated in
  favour of `mode`, but still accepted, and are kept deliberately: an older
  self-hosted instance wouldn't know `mode`, and strict parsing would reject it.

`verifyConnection` deliberately checks the **whole** configuration, not just
that the token authenticates: the named site must exist and one of the org's
registered domains must cover this instance's `baseDomain`, since without either
no resource can ever be created. The old version listed sites and called it a
pass, which is how a setup that could never work reported "Org access verified".
`tests/unit/app/pangolin.test.ts` drives all of this against a stubbed API that
caps pages at 10 rows regardless of the requested size, so a client that stops
after page one fails the test.

**Cloudflare is still not live-tested against a real registered account**, same
posture as `GitProviderService`'s OAuth flow: built from the documented API
shapes, verify the first real sync by hand once a zone/token is configured.
