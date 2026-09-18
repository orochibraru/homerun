# FAQ & limitations

Homerun is new. If you're used to another self-hosted PaaS, most of what you
expect is here, but some things work differently and a few aren't built yet.
This page is the honest list, so you find out here rather than halfway through
moving your services over.

## Is this production-ready?

It's actively developed and runs on real hardware, but it's a single-maintainer
project, and "production" here means your homelab or your own server. Keep
[backups](storage-volumes.md), and take a Postgres dump before a major upgrade:
migrations only run forward.

## Can several people share the same services?

Yes. Every account sees and manages every service, stack, volume, backup and the
rest of the instance's resources, whoever created them. Sessions, API keys,
preferences, git connections, the bell feed and notification channels stay
personal. There are no teams and no per-stack permissions: the two roles, admin
and developer, only differ in which instance-wide pages they can open. An API
key has the full permissions of its account. Deleting an account hands what it
created over to another admin. See [Users and roles](users-and-roles.md).

## Can it build an app without a Dockerfile?

Yes. Besides a `Dockerfile` or a Docker Bake file (both built with BuildKit), a
git-based service can be built with Nixpacks, Railpack, or Cloud Native
Buildpacks (Heroku or Paketo builders), picked as the build method on the Source
tab. A build clones a branch, a tag or a specific commit, and pull requests can
get their own preview deployment. See
[Build methods](deploy-source-and-builds.md#build-methods).

## Can it deploy to more than one server?

Not the way you might expect. Services run on the machine Homerun is installed
on. To spread a service across machines you turn on [swarm mode](swarm-mode.md)
and join the other machines to the swarm as workers. There's no "add a server
and deploy to it" screen. [Build servers](remote-hosts-and-agent.md) only
compile images, they never run services.

## Does it manage databases?

Not as a separate kind of resource. PostgreSQL, MySQL, Redis, MongoDB and others
are [templates](templates.md) deployed like any other service, and
[service links](env-vars.md) fill in the connection URL for the apps that use
them. Backups tar the database's volume while it runs, they don't run a dump
tool, so read the backup warning below.

## Can I bring my existing services over?

Mostly. **Settings → Migrate** reads another instance's applications, compose
stacks and databases with an API token and recreates them here without touching
the original. Apps built with Nixpacks, Railpack or buildpacks come across with
the same builder, along with their start commands, Dokploy's private registry
credentials and file mounts; static build packs can't. Persistent storage isn't
always listed by the other side's API, so check volumes after importing. A
pasted compose file works too, including `command`, `entrypoint`, `env_file`,
labels, `cap_add`, devices and `privileged`; `healthcheck`, secrets and configs
are dropped with a warning. See [Importing a compose file](compose-import.md).

## Known, real limitations (not hypothetical)

- **The default install runs Docker as root.** Swarm mode, the default, needs
  the system Docker daemon because rootless Docker can't create overlay
  networks, and anything that can reach that daemon's socket is root on the
  host. `--docker=rootless` keeps Docker under an unprivileged user at the cost
  of swarm (standalone mode only). A rootless install moves over with
  `--migrate-to-rootful`, see
  [Getting started](getting-started.md#moving-a-rootless-install-to-rootful--swarm).
- **Swarm mode only sees this host's replicas.** Per-replica usage, the Terminal
  tab and pre-backup commands only reach replicas running on this machine, and
  the uptime "from the network" probe doesn't run for swarm services.
- **Swarm mode ignores privileged mode and devices** and doesn't give a stack
  its own network. With several nodes, volumes are per node and locally built
  images need a build cache registry. See [Swarm mode](swarm-mode.md).
- **Cloudflare and Pangolin DNS automation haven't been tried against real
  accounts.** Every deploy writes what each provider did into its log, so read
  the first one. Point Pangolin at its **Integration API** (its own port, base
  path `/v1`), not the dashboard's `/api/v1`. See
  [DNS automation](dns-automation.md).
- **Deploy on push without a reachable dashboard polls every two minutes.** A
  GitHub repo can't deliver a webhook to a dashboard only reachable on your LAN,
  so Homerun reads the branch head through the provider's API instead, which
  only works for GitHub, GitLab, Gitea and Bitbucket. Pull request previews
  still need the webhook.
- **Every publicly routed app depends on the dashboard being up.** The login
  wall's check is attached to every service so it can be switched on and off
  without a redeploy, which means Traefik refuses requests to any routed app
  while Homerun itself is down. Removing someone at your identity provider is
  picked up within about five minutes when the app filters on groups and the
  provider issues refresh tokens, otherwise at their next sign-in or within
  eight hours. See [Per-app login wall](login-wall.md).
- **Backups aren't paused for writes.** A volume is tarred while its service
  keeps running, which can tear a database mid-write. Dump the database into a
  bind mount with a [cron job](scheduling.md#cron-jobs) and back that up
  instead. See [S3 backups](backups.md#s3-compatible-backups).
- **Restoring a backup unpacks over the volume** without wiping it or stopping
  anything. Stop the services using it first. See
  [S3 backups](backups.md#restoring-a-backup).
- **A rollback only restores the image.** Env vars, volumes and networking stay
  as they are now, and only the last 5 images of a service are kept on the host
  (configurable under Settings → Docker). Auto-rollback is off by default and
  replaces an unhealthy revision after it has taken traffic. See
  [Revisions and rollback](revisions-and-rollback.md).
- **Pruning volumes in Docker Cleanup deletes data**, including volumes of
  services you've only stopped. Read the preview. See
  [Docker Cleanup](docker-cleanup.md).
- **Image scanning lets a deploy through when it couldn't finish**, unless
  **Fail deploys when the image can't be scanned** is ticked under Settings →
  Docker. See [Image scanning](image-scanning.md).
- **Health-gated redeploys need a healthcheck to really gate.** Without one the
  new container takes traffic as soon as it's been running a few seconds, and a
  service on host networking or with a writable volume still stops the old
  container first. See [Deploying](deploying.md).
- **Changing your own verified email needs SMTP configured**, since the change
  is confirmed from the current address. Without SMTP, an admin can change it
  directly from `/users`. See [Your profile](your-profile.md).
- **A direct-created account is a race without SMTP configured.** It has no
  password until it's chosen one at its first sign-in, and without SMTP there's
  no code step proving who's asking, so anyone who knows the new account's email
  can set its password before its real owner does. See
  [Users and roles](users-and-roles.md).
- **Every registry token can both push and pull.** The built-in registry's
  htpasswd auth has no concept of scopes or read-only access without running a
  separate token server, so there's no pull-only credential to hand out. See
  [Registry](registry.md#tokens).
- **Publishing the registry through a real Traefik hostname hasn't been pushed
  to yet.** Only the container's own htpasswd auth was verified directly
  (anonymous/wrong-password rejected, correct token accepted, a real
  `docker push` landed in the catalogue); a push over a published hostname with
  a real certificate is untested. See [Registry](registry.md#whats-verified).

The live backlog is [`TODO.md`](../TODO.md).

## Where do I report a bug or ask something not covered here?

Open an issue against the repo. If you're contributing code, read
[`CLAUDE.md`](../CLAUDE.md) and the `.agents/notes/` it points to first.
