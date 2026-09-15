# FAQ & limitations

## Is this production-ready?

It's actively developed and running on real hardware, but it's a
single-maintainer project and "production" here means _your_ homelab or single
server, not a multi-tenant SaaS. Read this whole page before trusting it with
something you'd mind losing, and keep backups (see
[Storage & backups](storage-and-backups.md)).

Releases are versioned and published automatically from `main`, so the version
you're running is whatever the image tag says, `latest` tracks the newest
release. Pin `HOMERUN_VERSION` in `.env` if you'd rather upgrade deliberately,
see [Operations](operations.md#upgrading-homerun-itself).

## Do I have to edit config files?

No. The installer sets up everything the container needs to boot, and from your
first sign-in onwards, base domain, Docker, Traefik, email, sign-in methods, DNS
automation and orchestration mode are all pages in the dashboard.

Three values are env-only and always will be: the database URL (needed before
there's a database to read settings from), `AUTH_SECRET` (it's the key the
stored settings are encrypted _with_, so it can't live among them), and `ORIGIN`
(changing the scheme at runtime would rename your session cookie and sign
everyone out). The installer writes all three; with plain `docker compose` you
set two of them once. A `homerun.yaml` file exists for people who want
configuration as code, and is entirely optional, see
[Configuration](configuration.md).

## Does it support multiple hosts / Kubernetes-style orchestration?

Not a Kubernetes-equivalent control plane, no, that's still by design, see the
README's "Why Homerun". Extra capacity comes from opt-in Docker
[Swarm mode](services.md#swarm-mode), which gives real replica scaling and load
balancing for a single service: a second machine joins the swarm as a worker
(`packages/installer/swarm-join.sh`) and Docker schedules onto it. Homerun
itself only ever talks to the local manager.
[Build servers](remote-hosts-and-agent.md) are a separate thing, a second
machine that compiles images, not one that runs them. `service.containerId`
still being a single column is what standalone mode (the default) is built
around; swarm mode is the separate, newer path around that limitation for
services that opt in.

## Known, real limitations (not hypothetical)

- **OAuth / OIDC sign-in** needs **Origin** set under Settings → General and
  matching how you actually reach Homerun: the redirect URI sent to your
  provider is built from it, and providers reject any URI they weren't given in
  advance. See [Users & access](users-and-access.md#authentication-providers).
- **The login wall's Auth-check URL defaults to port 3000**, which is right for
  a normal deployment but wrong under `vite dev` (which serves on 5173 and
  doesn't set `PORT`). Set Auth-check URL explicitly under Settings → General
  when developing, or the wall's checks call a port nothing is listening on.
- **The per-app login wall** needs **Origin** set under Settings → General
  (that's where visitors are sent to sign in), and the service has to be
  redeployed after the wall is turned on or off. Group restrictions depend on
  your provider actually putting group or role claims in the id token. See
  [Users & access](users-and-access.md#per-app-login-wall).
- **Changing a verified account's email needs SMTP configured.** The new address
  has to be confirmed from a link sent to the _current_ one, so with no mail
  server there's no way to prove it; the field on your profile locks itself with
  an explanation until Settings → Email is set up. An unverified address changes
  immediately on save, no confirmation involved. See
  [Users & access](users-and-access.md#your-profile).
- **Custom SSL certs** require a one-time manual Traefik config change
  (`TRAEFIK_DYNAMIC_CONFIG_DIR` + uncommenting flags in `compose.yaml`), Homerun
  writes the cert files but never touches the live Traefik container itself. See
  [Services: custom domains & SSL](services.md#custom-domains--ssl).
- **Build servers** only build; they never run your services, and one always
  needs a build-cache registry so the image it produced can reach the host that
  deploys it. See [Build servers](remote-hosts-and-agent.md).
- **Git-based builds** clone by branch/tag only, a bare commit SHA doesn't work,
  and have no webhook/auto-deploy-on-push yet.
- **S3 backups** cover both volume kinds now (a Docker-managed volume is read
  out through a short-lived helper container), but there's still no restore
  flow, upload only.
- **`packages/installer/swarm-join.sh`** (joining a remote box to an existing
  swarm) hasn't been run against a real second host or a real swarm yet, unlike
  the rest of the installer, which has (`--mode=agent`/`--mode=full`, see
  [`packages/installer/README.md`](../packages/installer/README.md)). Verify by
  hand before relying on it.
- **Swarm mode** is local-manager-only, see
  [above](#does-it-support-multiple-hosts--kubernetes-style-orchestration): a
  second machine joins the swarm as a worker rather than being registered
  separately, and `packages/installer/swarm-join.sh` has not been verified
  against a real swarm yet.
- **Cloudflare and Pangolin DNS automation** are new and neither has been
  exercised against a real account by the maintainer. Point Pangolin at its
  **Integration API** (a separate server on its own port, base path `/v1`), not
  the dashboard's `/api/v1`, which is the usual reason a setup that looks right
  doesn't work. "Test connection" checks the whole configuration rather than
  just the credentials, and every deploy writes what each provider did into that
  deploy's own log, so verify the first real sync by reading it. See
  [Services: DNS automation](services.md#dns-automation).
- **Pruning Docker volumes deletes data.** `/docker-cleanup` is host-wide and
  deliberately not limited to containers Homerun created; an "unreferenced"
  volume includes one belonging to a service you stopped and meant to restart.
  Read the preview. See [Operations](operations.md#docker-cleanup).
- **Backups aren't quiesced.** A volume is tarred while the service using it
  keeps running, which is fine for files and can tear a database mid-write. Dump
  databases with their own tooling into a bind mount and back that up instead.
  See [Storage & backups](storage-and-backups.md#s3-compatible-backups).
- **Passkeys and two-factor sign-in aren't exposed yet.** The underlying support
  is wired up server-side but there's no UI for enrolling or using either, so
  today it's passwords and OAuth/OIDC.
- **Compose import** maps what Homerun has an equivalent for and tells you what
  it dropped, it is not a compose runtime: `build:`, `command:`, healthchecks,
  capabilities, `env_file`, secrets/configs and host port publishing all come
  back as warnings on the preview rather than being applied. See
  [Services: importing a compose file](services.md#importing-a-compose-file).
- **Host command cron jobs** run with this app's own privileges (as root inside
  the app container, on the app's own filesystem, not the host's, when Homerun
  itself runs in a container). They're admin-only for that reason. See
  [Services: cron jobs](services.md#cron-jobs).
- **Live progress uses server-sent events, not WebSockets.** SvelteKit 2 has no
  WebSocket route API, so deploy progress and container logs are one-way server
  push over HTTP instead. Nothing in the dashboard needs a client-to-server
  socket today; the web terminal, which does, uses its own chunked-HTTP channel.

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
- **Backup restore**, getting a tarball back into a volume from the dashboard.
  Uploads work; restoring is manual today.
- **Passkeys and 2FA**, plus instance-level policies to require them.
- **Auto-deploy on push**, a webhook from your git provider triggering a
  rebuild, rather than redeploying manually or on a schedule.

See the repo's [`TODO.md`](../TODO.md) for the live, granular backlog, this page
is the "what should a self-hoster know before relying on X" summary of it.

## Where do I report a bug or ask something not covered here?

Open an issue against the repo. If you're contributing code, read
[`CLAUDE.md`](../CLAUDE.md) first, it's the denser, implementation-level
counterpart to this docs directory, including exactly what's been verified live
vs. reasoned-about-but-untested for each feature.
