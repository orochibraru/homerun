# Services

A **service** is one deployed container. Create one from `Services → New`,
either standalone or pre-filled from a [project](projects-and-templates.md) or
[template](projects-and-templates.md#templates) via
`?projectId=`/`?templateId=`. The wizard's primary button, **Create and
Deploy**, persists the config and immediately deploys it, landing you on the new
service's Overview tab; **Create service**, the secondary button, just persists
the config, the same as before, deploy later from the Overview tab yourself.

## The services list

`Services` has a search box (matches name, image, and domain) plus Status/
Project filters, and a list/card view toggle that remembers your choice per
browser; both the search and filters are applied on the server, so they reach
every service you own, not just whichever page happens to be on screen. Once you
have more than a page's worth, a pager at the bottom shows "26–50 of 60" and
lets you step through the rest. Check one or more services (a "select all"
scopes to whatever's on the **current page**, paginating or changing the
search/filters clears your selection) to bring up a bottom bar with bulk
Start/Stop/Restart/Delete: bulk actions run against every selected service and
report back which ones succeeded, so one service with no container yet doesn't
block the rest. Bulk delete, and the single-row delete on this page and the
danger-zone delete on a service's own Settings tab, all require typing a
confirmation phrase (the service's name for a single delete, `delete N services`
for a bulk one) before the button unlocks, an irreversible action gets a real
"are you sure" rather than a single click.

## Deploy source: image or git repo

Every service is either:

- **Bring-your-own-image** (the default), an image + tag, optionally with
  private registry credentials.
- **Build from a git repo**, Homerun clones the repo (shallow, by branch/tag, a
  bare commit SHA isn't supported) and builds its `Dockerfile` locally. No
  registry involved: the build produces a fresh local image tag
  (`homerun-build-<slug>:<timestamp>`) every deploy.

Toggle between the two on the **Source** tab (also available on the New Service
wizard). Any git-clone-able HTTPS URL works, GitHub, GitLab, a self-hosted
Gitea, anywhere, since cloning doesn't need a provider-specific API. If you've
connected a git provider account (`/git-providers`, OAuth), the Source tab gets
a repo-browsing picker instead of pasting a raw URL; a private repo can also
fall back to a token embedded directly in the URL (`https://TOKEN@host/...`)
without connecting a provider at all.

There's no webhook / auto-deploy-on-push yet, redeploy a git-mode service the
same way as an image-mode one: manually, or via its own cron schedule (below)
for `:latest`-tracking-equivalent auto-rebuilds.

### Connecting a git provider

`Git Providers` in the sidebar is what turns "paste a clone URL" into "browse my
repos", and it's how a private repo works without putting a token in the URL.
There are two steps, and they're done by different people:

1. **An admin registers an OAuth app**, once per provider. Pick GitHub, GitLab,
   self-hosted Gitea (which also wants its base URL) or Bitbucket, register an
   OAuth application on that provider's own site, and paste the client id and
   secret in. The page prints the exact callback URL to register on the
   provider's side.
2. **Each person connects their own account** from the same page, one click
   through the provider's consent screen. Connections are per-account: your
   token is yours, and another user connecting to the same provider gets their
   own.

Once connected, the **Browse repos** picker on a service's Source tab (and in
the new-service wizard) lists the repositories that account can see, and checks
the branch you pick for a `Dockerfile` before you commit to it. Tokens are
stored encrypted, and disconnecting removes them.

This is only about _browsing and access_. Cloning itself is provider-agnostic,
so any public HTTPS git URL works with no provider connected at all.

### Build servers and build cache

By default a git build runs on this host. Two optional pickers on the Source tab
change that:

- **Build cache registry**, a registry credential registered under
  `/build-cache-registries`. The build pulls the previous image from it as a
  layer cache and pushes fresh layers back, so a repeat build reuses what the
  last one produced instead of starting cold. Both directions are best-effort: a
  missing cache image or a failed push logs and carries on rather than failing
  the build.
- **Build server**, a second machine that compiles the image instead of this
  one, see [Build servers](remote-hosts-and-agent.md). Picking one **requires**
  a cache registry, since publishing through that registry is the only way the
  built image reaches the host that runs it.

## Importing a compose file

**Import compose** on the services list takes a `docker-compose.yaml` pasted
straight in and turns it into Homerun rows. Parsing happens on the server and
nothing is created until you confirm: the preview lists every service it found
with the image, port, protocol, network mode, env var count and volume mounts it
resolved, plus a warning for anything it had to drop.

What maps across: `image`, `environment` (both the map and the `KEY=VALUE` list
form), `ports`/`expose` (the container side, the host side is dropped, Homerun
routes through Traefik instead), `restart`, `volumes` (named volumes and
absolute bind mounts, in both the short `src:dst:ro` and long `type:/source:`
forms), `depends_on`, `network_mode: host`, `container_name`, and
`deploy.resources.limits.cpus`/`memory`.

What comes back as a warning instead of being applied: `build:` (import it, then
point the service's Source tab at a git repository), `command`, `entrypoint`,
`healthcheck`, `env_file`, `labels`, capabilities, devices, `privileged`,
secrets/configs, relative bind mounts (Homerun needs an absolute host path), and
anonymous volumes.

Every named volume and absolute bind mount becomes a
[storage volume](storage-and-backups.md) (reusing an existing one when the
source matches) and is mounted into the service at its declared path. A service
that published a host port gets a public `<slug>.<domain>` route; one that only
`expose`d a port stays internal. You can drop individual services from the
import, put the stack in a new or existing project, and optionally deploy
everything straight away, in `depends_on` order.

## Deploying

The Overview tab has Deploy/Start/Stop/Restart plus a live progress panel. The
panel shows six phases, resolving configuration, preparing volumes, fetching
image, provisioning container, routing traffic, ready, ticking off as they
complete, with the raw build/pull output streaming underneath. Progress arrives
over server-sent events (the server pushes each new line and status change; if
that stream can't be held open, the panel falls back to polling), and it resumes
correctly if you reload the page mid-deploy, or if the deploy was started
somewhere else entirely (a template quick-deploy, cron). Below it, deployment
history lists every attempt with status, image digest, and an expandable full
log.

Clicking Deploy **queues** the deploy rather than running it inside the request
(see [The job queue](#the-job-queue) below), so the button comes back
immediately and the progress panel narrates the rest. Same for "Create and
Deploy" at the end of the new-service wizard: it creates the service, queues the
deploy, and drops you straight on the service page watching it come up.

## The job queue

Deploys, git builds, volume backups and Docker cleanups all run through one
background worker instead of inside the request that triggered them. That buys
four things worth knowing about as an operator:

- **Repeats collapse.** Queueing a deploy for a service that already has one
  waiting doesn't queue a second, it joins the one that's already there. Push
  five times in a minute to a git-based service on a redeploy schedule and you
  get one build, not five.
- **One deploy per service at a time.** Different services still deploy in
  parallel (up to three jobs at once); the same service never deploys twice
  concurrently.
- **Linked services keep their order.** Deploying a template that links a
  database or cache queues the companions first and the primary service behind
  them, and if a companion fails, the primary is cancelled rather than started
  against a missing dependency.
- **A Docker cleanup runs alone.** A host-wide prune waits for anything already
  running to finish and holds new work back while it runs, so it can't delete
  images or build cache out from under a deploy in flight. It does take
  precedence over deploys that are merely queued.

The **Scheduling** page has a Job queue panel showing what's running, what's
waiting, and how recent jobs finished. Work that was still running when the app
was restarted is put back on the queue at next boot.

A failed deploy is not retried automatically, you'll see it fail and decide;
backups get one retry.

## Env vars

Plain key/value rows on the Env Vars tab, stored as-is (not encrypted, don't put
a raw plaintext secret you'd mind leaking in the DB dump into an env var if you
can avoid it; registry passwords and similar have their own encrypted fields
instead).

**Link a service** in the new-service wizard's Environment step fills those rows
in for you from a service you already run, in any project or none: pick it, and
Homerun recognises what it is from its image (PostgreSQL, MySQL/MariaDB,
MongoDB, Redis/Valkey, RabbitMQ, or a plain HTTP service) and reads the
credentials off its own env vars. You then choose the shape you want:

- **Connection URL**, e.g. `POSTGRES_URL=postgres://app:secret@db:5432/app`.
- **JDBC URL** (relational engines only), e.g.
  `jdbc:postgresql://db:5432/app?user=app&password=secret`.
- **One variable per value**, e.g. `DB_HOST`, `DB_PORT`, `DB_USER`,
  `DB_PASSWORD`, `DB_DB`.

The suggested variable name (or prefix) is a default, not a rule, rename it to
whatever your app expects before adding it. The host in every generated value is
the linked service's slug, which is how services already reach each other on the
shared network, so this works across projects and needs no extra networking.

## Volumes

Mount a [storage volume](storage-and-backups.md) into the container path of your
choice, read-write or read-only, from the Volumes tab, including creating a
brand-new volume inline without leaving the page. A volume becomes "shared"
simply by mounting it into more than one service.

## Networking

Everything on this tab is written onto the container as Traefik labels at
**create** time, so saving a change here doesn't affect the container that's
already running. Once a service has been deployed, the tab shows a **Redeploy**
button for exactly that reason, use it after changing a custom domain,
DNS-resolvability, or the login wall.

- **Container port, protocol, network mode**, `bridge` (default, joins the
  shared `homerun` plus the service's project network if any) or `host` (shares
  the host's network namespace directly, for apps needing real host-network
  access like mDNS/SSDP discovery). Homerun never publishes/maps a host port
  either way; a bridge-mode service is reachable only via its Traefik subdomain,
  a host-mode service only directly on the host's own port.
- **DNS-resolvable**, whether Traefik gets discovery labels at all. Forced off
  automatically in host mode (there's no per-container IP for Traefik's Docker
  provider to route to).
- **Custom domain**, an optional second hostname (in addition to the automatic
  `<slug>.<baseDomain>` one), routed to the same backend.

### DNS automation

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

**Cloudflare** needs an API token with DNS edit permission on the zone, plus the
zone id. **Test connection** on the settings page verifies both before you save.

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
- Optionally a **target port**, defaulting to 80, since Pangolin terminates
  public TLS itself.

**Test connection** checks the whole set rather than just that the token
authenticates: it confirms the site exists, and that one of your registered
Pangolin domains actually covers this instance's base domain, since without that
no service hostname could ever be routed. A token-only check passed on setups
that could never work.

> Neither integration has been exercised against a real account by the
> maintainer yet, so verify the first real sync by reading the deploy log it
> writes to. See [FAQ & limitations](faq-and-limitations.md).

### Custom domains & SSL

A custom domain outside your instance's own base domain can't use Traefik's
automatic ACME resolver, so the Networking tab's SSL section lets you paste your
own cert/key PEM (encrypted at rest, same scheme as registry credentials).
**This is a no-op until an admin sets `TRAEFIK_DYNAMIC_CONFIG_DIR`** (see
[Configuration](configuration.md)) and uncomments the matching Traefik
flags/mount in `compose.yaml`, a one-time setup step Homerun deliberately
doesn't perform on the live Traefik container itself. Once configured, saving a
cert writes the cert/key/dynamic-config files into that directory and Traefik's
file provider picks them up on its own (no restart per certificate).

### Per-app login wall

The Networking tab's **Access** section puts a login wall in front of the
service. An anonymous visitor is redirected to this instance's own sign-in
screen, and sent back to the page they asked for once they're through. Pick
which sign-in methods that app accepts (built-in login, and any OAuth provider
configured on the Authentication page), and optionally restrict access to
specific users, email addresses or provider groups. Redeploy the service after
changing whether the wall is on, since the middleware is attached through the
container's Traefik labels. Full detail, including what the app receives about
the signed-in visitor, is in
[Users & access](users-and-access.md#per-app-login-wall).

## Compute

CPU and memory limits on the Compute tab, applied as real Docker resource limits
on the next deploy. The same tab carries the replica count used by
[swarm mode](#swarm-mode); it has no effect in standalone mode, where a service
is always one container.

## Swarm mode

Instance-wide, opt-in (`/settings` → Docker → Orchestration mode → `swarm`), an
alternative to the default one-container-per-service model: once enabled, every
**local** deploy creates a real Docker Swarm Service instead of a plain
container, and the Compute tab gets a **replicas** field (default 1) controlling
how many copies Docker runs and load-balances across via its own routing mesh.
Start/ stop map to scaling to 0/back up rather than a real container stop/start,
and restart force-updates every task (recreating them) instead of restarting one
container.

Requires the host's own Docker daemon to already be swarm-active
(`docker swarm init`, a one-time step Homerun doesn't do for you) and the live
Traefik container to have `--providers.docker.swarmMode=true` added to its
command, another one-time `compose.yaml` edit + restart, same "admin does the
one-time infra change" pattern as custom SSL's `TRAEFIK_DYNAMIC_CONFIG_DIR`.

**Adding a node**: a second machine joins the swarm as a worker rather than
being registered separately. `packages/installer/swarm-join.sh` (see
[`packages/installer/README.md`](../packages/installer/README.md)) joins a box
to an existing swarm and installs the Homerun Agent on it; the swarm scheduler
places tasks there from then on.

## Logs

The Logs tab live-streams a running container's stdout/stderr straight from the
browser: the server pushes each line as the container writes it over a long-
lived HTTP response, no polling and no WebSocket (SvelteKit 2 has no WebSocket
route API; nothing here needs a client-to-server socket anyway). The same viewer
is embedded on the Overview tab once a service has deployed at least once, so
recent output is visible without switching tabs.

## Terminal

An interactive `/bin/sh` into the live container, from the browser, only
available while the service is `running`. Open/close events are logged;
individual keystrokes/commands are not (that's a deliberate scope cut, not an
oversight, raw TTY bytes don't map cleanly to discrete commands anyway).

## Scheduled redeploy

Off by default, per service, the Settings tab's `cronEnabled` checkbox + a
standard 5-field cron schedule. Useful for an image tracking `:latest`, or a
git-mode service you want rebuilt on a schedule rather than manually. A due
schedule queues a deploy like any other trigger, so a redeploy that's still
waiting its turn is never queued twice.

## Cron jobs

**Cron Jobs** in the sidebar is the other half of scheduling: a task on a
schedule that isn't tied to a service. Each job runs one of two ways:

- **Container**: an image (plus optional tag, command override, env vars, and
  private-registry credentials) run as a throwaway container. Homerun pulls the
  image if it's missing, runs it to completion, keeps its stdout/stderr, and
  removes the container.
- **Host command**: a shell command run through `/bin/sh -c` where Homerun
  itself runs. **Admin-only**, since it inherits the app's own privileges.

Give it a 5-field cron schedule, a timeout (default 900s, the job is killed past
it), and turn the schedule on or off without deleting the job. Runs go through
the same [job queue](#the-job-queue) as deploys and backups, so **Run now**
returns immediately and one job never runs twice concurrently. Each run's exit
code and captured output are kept on the job's page, and enabled jobs also show
up on the Scheduling page next to cron redeploys and backups.

## Errors

A per-service Errors tab surfaces both failed deployments and a live "container
currently down" banner, plus an "Application errors" section, persisted
warn/error-level app log lines that mention this service, a lightweight view of
app-level failures alongside deploy failures. If a service's container was
removed outside Homerun (e.g. a manual `docker rm`), the tab shows a distinct
"container is gone" banner with a **Resolve** button instead: click it to clear
the stale reference so the service goes back to its normal never-deployed state
and Deploy works again.

## Notifications

The bell in the header shows a per-account feed of lifecycle events for your
services, deploy succeeded or failed, service created, started or stopped, an
auto-redeploy firing, and runtime errors. Click an entry to jump to its service.
See [Operations](operations.md#notifications) for how it differs from the Errors
tab's persisted log view, and for sending the same build/update/deploy/uptime
events out to a Discord webhook, a generic webhook, or email.

## Settings

Name, slug, restart policy, which project the service belongs to, the
[scheduled redeploy](#scheduled-redeploy) above, and a danger-zone delete
(typed-confirm, see [The services list](#the-services-list)).

**Save as template** is here too: it snapshots this service's current image,
tag, port, env vars and resource limits into a reusable template of your own,
which then behaves exactly like a built-in one, including being linkable as a
companion to another template. See
[Projects & templates](projects-and-templates.md#templates).

## Next steps

- [Projects & templates](projects-and-templates.md)
- [Storage & backups](storage-and-backups.md)
- [Build servers & the Homerun Agent](remote-hosts-and-agent.md)
- [Operations & maintenance](operations.md)
