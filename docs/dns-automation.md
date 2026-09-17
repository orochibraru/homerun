# DNS automation

If your instance's DNS is on Cloudflare, or you front it with a self-hosted
[Pangolin](https://github.com/fosrl/pangolin) tunnel instead, configure one (or
both) from `/settings` → Networking and Homerun keeps DNS in sync on its own for
any service with **DNS-resolvable** on: a deploy creates or updates the record
(a Cloudflare CNAME, or a Pangolin Resource + Target), deleting the service
removes it, including its custom domain if it has one.

Both are best-effort and fire only after a successful deploy, a DNS failure
never fails the deploy itself. **What each provider did is written into that
deploy's own log**, so a sync that was skipped or rejected says so where you're
already looking, rather than only in the server's log. An empty result means no
DNS automation is configured, which is the default.

Neither is required. This is purely a convenience over pointing DNS at your
instance yourself.

**Cloudflare** needs an API token with the **Zone / DNS / Edit** permission on
the zone, plus the zone id. **Test connection** on the settings page checks that
the token can read the zone and list its DNS records, and that the zone actually
holds your base domain. It can't prove the token can write without writing, so a
read-only token still passes: the first deploy log is the real test.

What a sync does to a hostname's records, so re-running it is always safe:

- No record: creates a CNAME to your base domain, unproxied, automatic TTL, with
  the comment `Managed by Homerun`.
- A CNAME already pointing at your base domain: leaves it alone.
- A CNAME pointing elsewhere: changes only its target, so a proxy toggle, TTL or
  comment you set by hand survives.
- An A or AAAA record on that name: leaves it alone and says so in the deploy
  log, since Cloudflare won't allow a CNAME next to one.
- A hostname outside the zone (a custom domain on another DNS provider), or the
  base domain itself: skipped.

Deleting a service removes its CNAME only when it points at your base domain or
carries the `Managed by Homerun` comment, so a record you created by hand for
something else is never deleted.

**Pangolin** needs all of its fields, with any one blank the integration stays
off:

- **API base URL**: the **Integration API**, not the dashboard. Self-hosted
  Pangolin only exposes it once you enable it, it listens on its own port (3003
  by default), and its base path ends in `/v1`, e.g.
  `https://api.pangolin.example.com/v1`. A dashboard-style URL ending in
  `/api/v1` authenticates with a session cookie rather than an API key, so every
  call would fail.
- **Org ID** and an **API token** for it.
- **Main site name**: the Pangolin site (tunnel agent) whose host runs this
  instance's Traefik. It must already exist in Pangolin.
- Optionally a **target host**, the address the Pangolin site agent reaches
  Traefik at. Left blank it's detected: Traefik's container name when Newt runs
  as a container on the same network, `localhost` when it runs on this host with
  host networking. Set it when Newt runs on another machine. The page also tells
  you whether it found a Newt tunnel container on this host.
- Optionally the **Newt endpoint**, **Newt ID** and **Newt secret** from the
  site's page in Pangolin. With all three set, Homerun runs its own Newt tunnel
  client as a container named `homerun-newt` on the shared network next to
  Traefik. It isn't a service: it doesn't show up in your services list, it's
  recreated whenever you save these settings, and its logs are under System
  logs. Clear the fields to remove it. Leave them blank if Newt runs somewhere
  else. If you previously deployed Newt as a service yourself, delete that
  service first, two clients with the same credentials fight over the tunnel.
- Optionally a **target port**, defaulting to 443, where this instance's service
  routers live. A target on 80 reaches an entrypoint with no matching router and
  Traefik answers 404.
- **Let Pangolin handle sign-in**, off by default. On, the Resources Homerun
  creates keep Pangolin's own SSO and the [per-app login wall](login-wall.md)
  steps aside for anything Pangolin publishes, so visitors sign in once. Off,
  Homerun owns access and every Resource it creates has Pangolin SSO turned off.

**Test connection** checks the whole set rather than just that the token
authenticates: it confirms the site exists, and that one of your registered
Pangolin domains actually covers this instance's base domain, since without that
no service hostname could ever be routed. A token-only check passed on setups
that could never work. The domain must also be **verified** in Pangolin, and a
CNAME-type Pangolin domain only routes its own exact name, never a subdomain of
it. When several registered domains cover a hostname, the most specific one is
used.

Syncing Pangolin is safe to re-run too. An existing Resource for the hostname is
reused rather than duplicated: its SSO flag is changed only if it differs, and
its Target is repaired in place (host, port, scheme, site, enabled) instead of a
second one being added behind Pangolin's load balancer. A Resource you disabled
in Pangolin stays disabled, and the deploy log says so. Deleting a service
deletes its Resource, and one already removed by hand counts as done.

> Neither integration has been exercised against a real account by the
> maintainer yet, so verify the first real sync by reading the deploy log it
> writes to. See [FAQ & limitations](faq-and-limitations.md).
