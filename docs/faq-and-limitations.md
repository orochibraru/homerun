# FAQ & limitations

Homerun is new. If you're used to another self-hosted PaaS, most of what you
expect is here, but some things work differently and a few aren't built yet.
This page is the honest list, so you find out here rather than halfway through
moving your services over.

## Is this production-ready?

It's actively developed and runs on real hardware, but it's a single-maintainer
project, and "production" here means your homelab or your own server. Keep
[backups](storage-and-backups.md), and take a Postgres dump before a major
upgrade: migrations only run forward.

## Can several people share the same services?

No. Every service, stack, volume and backup belongs to the account that created
it, and nobody else sees it, admins included. A second account starts with an
empty dashboard. There are no teams, no shared projects and no per-stack
permissions: the two roles, admin and developer, only differ in which
instance-wide pages they can open. An API key has the full permissions of its
account. See [Users & access](users-and-access.md#roles).

## Can it build an app without a Dockerfile?

No. A git-based service is built from its `Dockerfile`; there's no Nixpacks,
Railpack or buildpack detection. A build clones a branch or a tag, not a
specific commit, and there are no pull request preview deployments. See
[Services](services.md#deploy-source-image-or-git-repo).

## Can it deploy to more than one server?

Not the way you might expect. Services run on the machine Homerun is installed
on. To spread a service across machines you turn on
[swarm mode](services.md#swarm-mode) and join the other machines to the swarm as
workers. There's no "add a server and deploy to it" screen.
[Build servers](remote-hosts-and-agent.md) only compile images, they never run
services, and each one needs a build cache registry.

## Does it manage databases?

Not as a separate kind of resource. PostgreSQL, MySQL, Redis, MongoDB and others
are [templates](stacks-and-templates.md#templates) deployed like any other
service, and [service links](services.md#env-vars) fill in the connection URL
for the apps that use them. Backups tar the database's volume while it runs,
they don't run a dump tool, so read the backup warning below.

## Can I bring my existing services over?

Mostly. **Settings → Migrate** reads another instance's applications, compose
stacks and databases with an API token and recreates them here without touching
the original. Apps built with Nixpacks, Railpack or buildpacks can't come
across, and neither can custom start commands, private registry credentials or
file mounts. Persistent storage isn't always listed by the other side's API, so
check volumes after importing. A pasted compose file works too, but `command`,
`entrypoint`, `healthcheck`, `env_file`, labels, capabilities, devices,
`privileged`, secrets and configs are dropped with a warning. See
[Services](services.md#importing-a-compose-file).

## Known, real limitations (not hypothetical)

- **Swarm mode needs manual setup.** Run `docker swarm init` and add
  `--providers.docker.swarmMode=true` to Traefik yourself.
  `packages/installer/swarm-join.sh`, which joins another machine, hasn't been
  run against a real second host yet. Check it by hand before relying on it.
- **Cloudflare and Pangolin DNS automation haven't been tried against real
  accounts.** Every deploy writes what each provider did into its log, so read
  the first one. Point Pangolin at its **Integration API** (its own port, base
  path `/v1`), not the dashboard's `/api/v1`. See
  [Services: DNS automation](services.md#dns-automation).
- **Custom SSL certificates need a one-time Traefik change**: set
  `TRAEFIK_DYNAMIC_CONFIG_DIR` and uncomment the matching flags and mount in
  `compose.yaml`. See
  [Services: custom domains & SSL](services.md#custom-domains--ssl).
- **Deploy on push needs the Dashboard URL reachable from your git provider.** A
  GitHub repo can't deliver a webhook to a dashboard only reachable on your LAN.
- **The per-app login wall needs a redeploy** after you turn it on or off.
  Removing someone at your identity provider takes effect at their next sign-in,
  or within eight hours. See
  [Users & access](users-and-access.md#per-app-login-wall).
- **Backups aren't paused for writes.** A volume is tarred while its service
  keeps running, which can tear a database mid-write. Dump the database into a
  bind mount with a [cron job](services.md#cron-jobs) and back that up instead.
  See [Storage & backups](storage-and-backups.md#s3-compatible-backups).
- **Restoring a backup unpacks over the volume** without wiping it or stopping
  anything. Stop the services using it first. See
  [Storage & backups](storage-and-backups.md#restoring-a-backup).
- **A rollback only restores the image.** Env vars, volumes and networking stay
  as they are now, and only the last 5 images of a service are kept on the host.
  Auto-rollback is off by default and replaces an unhealthy revision after it
  has taken traffic. See [Services](services.md#revisions-and-rollback).
- **Pruning volumes in Docker Cleanup deletes data**, including volumes of
  services you've only stopped. Read the preview. See
  [Operations](operations.md#docker-cleanup).
- **Notification channels don't retry.** A failed delivery is shown on the
  channel and dropped. See [Operations](operations.md#notifications).
- **Host command cron jobs run inside Homerun's own container**, not on the
  host. See [Services: cron jobs](services.md#cron-jobs).
- **Image scanning never blocks a deploy it couldn't finish.** If Trivy can't
  run, the deploy goes ahead, even with a block policy set. See
  [Services: image scanning](services.md#image-scanning).
- **Changing a verified email needs SMTP configured**, since the change is
  confirmed from the current address. See
  [Users & access](users-and-access.md#your-profile).

## Planned, not yet built

- **Telegram notifications.** Discord, generic webhooks and email work today.
- **Health-gated rollouts**, keeping the old container serving until the new one
  passes its health check.
- **Sharing between accounts** and finer permissions: teams, a read-only role,
  scoped API keys.
- **Builds without a Dockerfile** and pull request preview deployments.
- **DNS automation in the first-run wizard.**

The live backlog is [`TODO.md`](../TODO.md).

## Where do I report a bug or ask something not covered here?

Open an issue against the repo. If you're contributing code, read
[`CLAUDE.md`](../CLAUDE.md) and the `.agents/notes/` it points to first.
