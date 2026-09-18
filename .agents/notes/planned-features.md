# Planned features (intentional gaps)

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Planned features (not yet built)

Intentional gaps, noted so a future session has the intended shape rather than
re-litigating design decisions.

- **Observability**: per-service resource history (`stat_sample`) samples a
  standalone service's one container; swarm mode's `inspectSwarmServiceStatus`
  aggregates task state, not per-task resource usage, so there's no per-replica
  view.
- **Security**: the per-app login wall is built and works end to end (see
  Per-app login wall above); what's still missing there is finer-grained
  revocation than the 8h cookie lifetime for a user deleted or re-grouped at the
  provider. Custom SSL cert handling exists too (see below) but genuinely
  requires the admin's own one-time Traefik config change to take effect.
- **Source integration**: git-based builds and push-to-deploy webhooks exist
  (see Git-based builds and Push-to-deploy). Build servers exist too (see Build
  servers above); adding capacity for _deploys_ is Swarm's job, and
  `cmd/installer/swarm-join.sh` joins a node as a worker (verified on two real
  VMs, needs the system Docker daemon on every node, see `docker.md`).
- **Onboarding**: the forced first-run wizard now exists (`/onboarding`, see
  above), and setup diagnostics feed a highlighted deep-link into `/settings`
  instead of a standalone page; DNS automation itself now exists (Cloudflare and
  Pangolin, see above), but the wizard doesn't walk a new admin through
  configuring either one yet, that's still a manual `/settings` visit after
  onboarding finishes.
- **User roles**: admin/developer roles, admin-managed direct-create and email
  invites exist (see User roles & admin-managed accounts above), "developer" is
  a label plus route-gating only, no finer-grained permissions (e.g. no
  per-stack access control, no read-only role) built yet.
- **Notifications / webhooks**: the in-app lifecycle event feed exists (see
  In-app notifications above), and outbound notification channels now exist too
  (`notification_channel`, `NotificationChannelService`, see Outbound
  notification channels in `observability.md`) : generic JSON webhook, Discord
  embed, or email, each subscribed per-channel to any mix of build/update/
  deploy/uptime events, account-wide rather than tied to a status page.
  Provider-shaped payloads beyond Discord (Telegram, Slack) are still unbuilt,
  and there's no delivery retry, a failure is caught, logged and surfaced on
  `notification_channel.lastError`, not retried.

`TODO.md` at the repo root tracks open follow-up items separately from this
intentional-gaps list.
