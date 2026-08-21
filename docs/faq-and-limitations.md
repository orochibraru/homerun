# FAQ & limitations

## Is this production-ready?

It's alpha (`0.1.0-alpha`), and it's a single-maintainer project running on real hardware, but "production" for Homerun means _your_ homelab/single-server setup, not a multi-tenant SaaS. Read this whole page before trusting it with something you'd mind losing, and keep backups (see [Storage & backups](storage-and-backups.md)).

## Does it support multiple hosts / Kubernetes-style orchestration?

Not really, by design, see the README's "Why Homerun". [Remote hosts](remote-hosts-and-agent.md) let one instance deploy _individual_ services onto other machines, and [autoscaling](remote-hosts-and-agent.md#autoscaling--load-based-migration) can migrate one service off an overloaded host, but there's no replica scaling, no load balancing across multiple containers of the same service, and no plan to become a Swarm/Kubernetes-equivalent control plane. `service.containerId` is a single column throughout this codebase; that's a real architectural choice, not a gap waiting to be filled incidentally.

## Known, real limitations (not hypothetical)

- **Per-service auth gate** (`authRequired`) blocks _everyone_, including a signed-in admin, unless `AUTH_CROSS_SUBDOMAIN=true`, and even then it's not fully reliable. See [Users & access](users-and-access.md#per-service-auth-gate).
- **Custom SSL certs** require a one-time manual Traefik config change (`TRAEFIK_DYNAMIC_CONFIG_DIR` + uncommenting flags in `compose.yaml`), Homerun writes the cert files but never touches the live Traefik container itself. See [Services: custom domains & SSL](services.md#custom-domains--ssl).
- **Remote hosts** get no Traefik routing, no shared network, no host-port publishing, and skip bind-mount volumes entirely. See [Remote hosts](remote-hosts-and-agent.md#real-limitations-not-oversights).
- **Git-based builds** clone by branch/tag only, a bare commit SHA doesn't work, and have no webhook/auto-deploy-on-push yet.
- **S3 backups** cover bind-mount volumes only (no Docker-managed volumes), and there's no restore flow, upload only.
- **The Homerun Agent** (`agent/`) is a working standalone primitive, not yet wired into the main app's Remote Hosts UI.
- **The installer**'s mutating steps (package install, rootless Docker setup, systemd units) haven't been run against a real fresh box in CI, verify by hand, ideally with `--dry-run` first, before trusting the one-liner on a machine that matters.

## Planned, not yet built

- **Health-gated rollout**, blue-green style: keep the old container alive until a new deploy passes a health check, roll back if it doesn't.
- **Per-container resource stats**, `docker stats`-style observability beyond the host-level dashboard numbers.
- **Notifications / webhooks**, an in-app event feed, and outbound webhooks (Discord/Telegram/generic HTTP) on deploy success/failure.
- **DNS-provider automation**, Cloudflare/Pangolin-style automated DNS+TLS setup during onboarding.
- **Finer-grained permissions**, today "developer" is a role label plus route-gating only, not a real permissions system.

See the repo's [`TODO.md`](../TODO.md) for the live, granular backlog, this page is the "what should a self-hoster know before relying on X" summary of it.

## Where do I report a bug or ask something not covered here?

Open an issue against the repo. If you're contributing code, read [`CLAUDE.md`](../CLAUDE.md) first, it's the denser, implementation-level counterpart to this docs directory, including exactly what's been verified live vs. reasoned-about-but-untested for each feature.
