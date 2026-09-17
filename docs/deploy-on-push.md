# Deploy on push

Turn on **Deploy on push** on the Source tab (or in the wizard) and every push
to the service's branch deploys it, as its owner, without you touching the
dashboard.

- **Picked from a connected account**: Homerun adds the webhook to the repo
  itself when you save, and removes it when you turn deploy-on-push off, switch
  repos or delete the service. The Source tab says when it's registered.
- **A pasted clone URL**, or when Homerun couldn't register it (the account
  lacks webhook access, the provider couldn't be reached): the Source tab shows
  a payload URL and a secret, with the reason. Add a webhook in the repository's
  settings with those, sending push events as JSON. On GitLab the secret goes in
  **Secret token**.

Pushes to other branches, tags and pings are acknowledged and ignored, and a
delivery with a wrong signature is refused. A service pinned to a commit SHA
never matches a push. Webhooks need the **Dashboard URL** set under Settings →
General, and that address has to be reachable from the git provider.
`GET /api/v1/services/{id}/webhook` returns the same URL and secret.

**A dashboard the provider can't reach** (only on your LAN, behind a VPN):
whenever Homerun couldn't register the webhook, it polls the branch instead,
reading its head commit through the provider's API every two minutes with the
service owner's connection (or a token in the clone URL) and deploying when it
moves. The first read only records where the branch is. Tick **Poll the branch
for pushes** to poll even when a webhook is registered, for a provider that
accepts the webhook but can't deliver it. Polling needs a GitHub, GitLab, Gitea
or Bitbucket API, the same way status checks do.

**Reconnect to allow webhooks.** When the provider refuses to add the webhook (a
connection authorized without webhook access, a revoked token) or the service's
owner isn't connected any more, the Source tab offers **Reconnect** right there.
It goes through the provider's consent screen, brings you back to the Source
tab, and registers the webhook of every service of yours on that provider that
was missing one.

Without it, redeploy a git-mode service like an image-mode one: manually, or on
its own [cron schedule](scheduling.md#scheduled-redeploy).
