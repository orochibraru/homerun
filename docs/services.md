# Services

A **service** is one deployed container. Create one from `Services → New`,
either standalone or pre-filled from a [project](projects-and-templates.md) or
[template](projects-and-templates.md#templates) via
`?projectId=`/`?templateId=`. Creating a service just persists its config, it
doesn't deploy anything until you hit Deploy on the service's Overview tab.

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

## Deploying

The Overview tab has Deploy/Start/Stop/Restart plus a live progress panel,
pull-or-build, create, start steps stream in as they happen, and the panel
resumes correctly if you reload the page mid-deploy. Below it, deployment
history lists every attempt with status, image digest, and an expandable full
log.

## Env vars

Plain key/value rows on the Env Vars tab, stored as-is (not encrypted, don't put
a raw plaintext secret you'd mind leaking in the DB dump into an env var if you
can avoid it; registry passwords and similar have their own encrypted fields
instead).

## Volumes

Mount a [storage volume](storage-and-backups.md) into the container path of your
choice, read-write or read-only, from the Volumes tab, including creating a
brand-new volume inline without leaving the page. A volume becomes "shared"
simply by mounting it into more than one service.

## Networking

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
both) from `/settings` → DNS and Homerun keeps DNS in sync on its own for any
service with **DNS-resolvable** on: a deploy creates/updates the record (a
Cloudflare CNAME, or a Pangolin Resource + Target), deleting the service removes
it. Both are best-effort and fire only after a successful deploy to the
**local** host, a DNS sync failure never fails the deploy itself, it just logs a
warning. Neither is required, this is purely a convenience over pointing DNS at
your instance yourself.

> Both integrations are new and haven't been exercised against a real
> Cloudflare/Pangolin account yet, verify the first real sync by hand once
> you've configured one. See [FAQ & limitations](faq-and-limitations.md).

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

### Per-service login gate

`authRequired` puts Traefik's forwardAuth middleware in front of the service, so
only someone logged into this Homerun instance can reach it. **Known
limitation**: there's no login page mounted on the gated subdomain itself, so
this blocks everyone, including a signed-in admin, unless
`AUTH_CROSS_SUBDOMAIN=true`, and even then it's not fully reliable (see
[Users & access](users-and-access.md#per-service-auth-gate)). Treat it today as
a hard "make this unreachable from outside" switch, not a finished SSO gate.

## Compute

CPU and memory limits on the Compute tab, applied as real Docker resource limits
on the next deploy. The same tab has the **autoscale-eligible** opt-in toggle,
see
[Remote hosts: autoscaling](remote-hosts-and-agent.md#autoscaling--load-based-migration)
for what that actually does (migration, not replica scaling, unrelated to swarm
mode below). Don't combine the two, autoscale-eligible isn't currently
swarm-aware and can end up trying to migrate a swarm-mode service to a remote
host, which swarm mode doesn't support (see below).

## Swarm mode

Instance-wide, opt-in (`/settings` → Orchestration → `swarm`), an alternative to
the default one-container-per-service model: once enabled, every **local**
deploy creates a real Docker Swarm Service instead of a plain container, and the
Compute tab gets a **replicas** field (default 1) controlling how many copies
Docker runs and load-balances across via its own routing mesh. Start/ stop map
to scaling to 0/back up rather than a real container stop/start, and restart
force-updates every task (recreating them) instead of restarting one container.

Requires the host's own Docker daemon to already be swarm-active
(`docker swarm init`, a one-time step Homerun doesn't do for you) and the live
Traefik container to have `--providers.docker.swarmMode=true` added to its
command, another one-time `compose.yaml` edit + restart, same "admin does the
one-time infra change" pattern as custom SSL's `TRAEFIK_DYNAMIC_CONFIG_DIR`.

**Local-manager-only for now**: a [remote host](remote-hosts-and-agent.md) has
to actually join the swarm as a worker, which is a different thing than just
being a registered `tcp://`/`ssh://` Docker daemon, so a swarm-mode service
can't currently target a Remote Host, deploying one there is rejected outright.
`installer/swarm-join.sh` (see [`installer/README.md`](../installer/README.md))
joins a box to an existing swarm as a worker and installs the Homerun Agent on
it, groundwork for closing this gap, not the integration itself yet.

## Logs

The Logs tab live-streams a running container's stdout/stderr straight from the
browser (chunked HTTP, not a WebSocket). The same viewer is embedded on the
Overview tab once a service has deployed at least once, so recent output is
visible without switching tabs.

## Terminal

An interactive `/bin/sh` into the live container, from the browser, only
available while the service is `running`. Open/close events are logged;
individual keystrokes/commands are not (that's a deliberate scope cut, not an
oversight, raw TTY bytes don't map cleanly to discrete commands anyway).

## Scheduled redeploy

Off by default, per service, the Settings tab's `cronEnabled` checkbox + a
standard 5-field cron schedule. Useful for an image tracking `:latest`, or a
git-mode service you want rebuilt on a schedule rather than manually.

## Errors

A per-service Errors tab surfaces both failed deployments and a live "container
currently down" banner, plus an "Application errors" section, persisted
warn/error-level app log lines that mention this service, a lightweight view of
app-level failures alongside deploy failures.

## Notifications

A bell icon in the header shows a per-user feed of lifecycle events, deploy
success/failure, service created/started/stopped, auto-redeploy fired, and
runtime errors, distinct from the Errors tab's persisted app-log view (this is a
short, curated list, not everything logged). Click a notification to jump to its
service, or mark all read from the dropdown.

## Settings

Name, slug, restart policy, which project the service belongs to, which
[remote host](remote-hosts-and-agent.md) it deploys to, save-as-template, the
cron schedule above, and a danger-zone delete.

## Next steps

- [Projects & templates](projects-and-templates.md)
- [Storage & backups](storage-and-backups.md)
- [Remote hosts & the Homerun Agent](remote-hosts-and-agent.md)
