# FAQ & limitations

## Is this production-ready?

It's alpha (`0.1.0-alpha`), and it's a single-maintainer project running on real
hardware, but "production" for Homerun means _your_ homelab/single-server setup,
not a multi-tenant SaaS. Read this whole page before trusting it with something
you'd mind losing, and keep backups (see
[Storage & backups](storage-and-backups.md)).

## Does it support multiple hosts / Kubernetes-style orchestration?

Not a Kubernetes-equivalent control plane, no, that's still by design, see the
README's "Why Homerun". [Remote hosts](remote-hosts-and-agent.md) let one
instance deploy _individual_ services onto other machines, and
[autoscaling](remote-hosts-and-agent.md#autoscaling--load-based-migration) can
migrate one service off an overloaded host. There **is** now real replica
scaling and load balancing for a single service, opt-in Docker
[Swarm mode](services.md#swarm-mode), but it's local-manager-only today: a
remote machine has to actually join the swarm as a worker
(`packages/installer/swarm-join.sh`), which isn't the same as registering it as
a Remote Host, so multi-host swarm scaling isn't wired up end-to-end yet either.
`service.containerId` still being a single column is what standalone mode (the
default) is built around; swarm mode is the separate, newer path around that
limitation for services that opt in.

## Known, real limitations (not hypothetical)

- **Per-service auth gate** (`authRequired`) blocks _everyone_, including a
  signed-in admin, unless `AUTH_CROSS_SUBDOMAIN=true`, and even then it's not
  fully reliable. See
  [Users & access](users-and-access.md#per-service-auth-gate).
- **Custom SSL certs** require a one-time manual Traefik config change
  (`TRAEFIK_DYNAMIC_CONFIG_DIR` + uncommenting flags in `compose.yaml`), Homerun
  writes the cert files but never touches the live Traefik container itself. See
  [Services: custom domains & SSL](services.md#custom-domains--ssl).
- **Remote hosts** get no Traefik routing, no shared network, no host-port
  publishing, and skip bind-mount volumes entirely. See
  [Remote hosts](remote-hosts-and-agent.md#real-limitations-not-oversights).
- **Git-based builds** clone by branch/tag only, a bare commit SHA doesn't work,
  and have no webhook/auto-deploy-on-push yet.
- **S3 backups** cover bind-mount volumes only (no Docker-managed volumes), and
  there's no restore flow, upload only.
- **`packages/installer/swarm-join.sh`** (joining a remote box to an existing
  swarm) hasn't been run against a real second host or a real swarm yet, unlike
  the rest of the installer, which has (`--mode=agent`/`--mode=full`, see
  [`packages/installer/README.md`](../packages/installer/README.md)). Verify by
  hand before relying on it.
- **Swarm mode** is local-manager-only, see
  [above](#does-it-support-multiple-hosts--kubernetes-style-orchestration), and
  isn't autoscale-aware, don't combine `autoscaleEligible` with a swarm-mode
  service.
- **Cloudflare and Pangolin DNS automation** are new and haven't been exercised
  against a real account yet, verify the first sync by hand once you've
  configured one. See [Services: DNS automation](services.md#dns-automation).

## Planned, not yet built

- **Health-gated rollout**, blue-green style: keep the old container alive until
  a new deploy passes a health check, roll back if it doesn't.
- **Per-container resource stats**, `docker stats`-style observability beyond
  the host-level dashboard numbers.
- **Outbound webhooks**, Discord/Telegram/generic HTTP notifications on deploy
  success/failure. The in-app notification feed (the bell icon) already exists,
  see [Services: Notifications](services.md#notifications).
- **DNS automation during onboarding**, Cloudflare and Pangolin sync now exist
  (see [Services: DNS automation](services.md#dns-automation)), but the
  onboarding wizard doesn't walk a new admin through configuring either one,
  that's still a manual `/settings` visit afterward.
- **Finer-grained permissions**, today "developer" is a role label plus
  route-gating only, not a real permissions system.

See the repo's [`TODO.md`](../TODO.md) for the live, granular backlog, this page
is the "what should a self-hoster know before relying on X" summary of it.

## Where do I report a bug or ask something not covered here?

Open an issue against the repo. If you're contributing code, read
[`CLAUDE.md`](../CLAUDE.md) first, it's the denser, implementation-level
counterpart to this docs directory, including exactly what's been verified live
vs. reasoned-about-but-untested for each feature.
