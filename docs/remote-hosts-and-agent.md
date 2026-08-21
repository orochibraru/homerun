# Remote hosts & the Homerun Agent

A service deploys to the local Docker socket by default. Registering a **remote host** and picking it as a service's deploy target (Settings tab) routes every Docker operation for that service — deploy, start/stop/restart, logs, status sync — at a different daemon instead.

## Registering a remote host

From `/remote-hosts`: a name, plus either

- `tcp://host:port` (+ optional TLS client cert for a secured Docker API), or
- `ssh://user@host`,

pointed at the target daemon directly. There is a lighter-weight alternative that doesn't require exposing the daemon itself — see [Homerun Agent](#homerun-agent) below (not yet wired into the Remote Hosts UI, see [FAQ & limitations](faq-and-limitations.md)).

## Real limitations, not oversights

The shared `homerun-network`, per-project networks, and Traefik itself all live on the **local** host. A remote-hosted container gets Docker's own default `bridge` network instead — no Traefik routing, no `<slug>` DNS alias, no project-network membership. It's reachable only however you arrange that yourself; there's deliberately no host-port-publishing UI for remote services either. **Bind-mount volumes are skipped entirely** on a remote deploy (a local path has no meaning on a different machine) — Docker-managed volumes still work, since Docker resolves those by name against whichever daemon it's pointed at.

Git-based builds work against a remote host too (the build step streams to whichever daemon the client points at) — but the `git clone` step itself always happens locally first.

## Autoscaling / load-based migration

**This is scoped-down "Cloud Run-like" load shedding, not elastic replica autoscaling** — Homerun has no concept of running more than one container per service, so it can't spin up N replicas and load-balance across them. What it does instead: when the local host crosses a configured resource threshold, **migrate** one opted-in service onto a designated overflow remote host (stop/remove the local container, deploy fresh on the remote one) — not replicate it.

Two-level opt-in, both required:

1. **Instance-wide** (`/settings` → Autoscaling): enabled + CPU/memory thresholds (default 80%) + which remote host absorbs the overflow.
2. **Per-service** (Compute tab): the `autoscaleEligible` toggle.

A background scheduler checks host stats every tick; if a threshold is crossed, it migrates exactly one eligible local service and re-checks next tick rather than moving several at once for a single reading. The overflow host must be owned by the same account as the migrating service — a mismatch is a safe no-op (logged), not a cross-account leak.

## Homerun Agent

A standalone binary (`agent/`) meant to run on a remote host's own Docker daemon, exposing deploy/start/stop/restart/logs/stats over a small token-authenticated HTTP API — the alternative to registering a remote host by raw `tcp://`/`ssh://` socket. Instead of exposing (or SSH-tunneling into) the daemon itself, the remote host runs this agent and the main app talks to it over plain HTTP with a bearer token.

```sh
cd agent
bun install
bun run dev              # talks to /var/run/docker.sock by default
```

Or compiled to a standalone binary (no Bun runtime needed on the target host): `bun run build:linux-x64` / `build:linux-arm64`. On first boot with no `AGENT_TOKEN` set, it generates one and prints it — see [`agent/README.md`](../agent/README.md) for the full env var and HTTP surface reference.

**This is a draft** — a working standalone primitive, but not yet wired into the main app (no schema column, no client service, no Remote Hosts UI support for pointing at an agent instead of a raw socket). It's the piece a future multi-host control-plane rearchitecture points at; see [FAQ & limitations](faq-and-limitations.md).

## Installer

`installer/` automates standing up a fresh Linux box with rootless Docker plus either the Agent or the full stack — this is what `docs/getting-started.md`'s one-liner runs. See [`installer/README.md`](../installer/README.md) for flags and what's verified.
