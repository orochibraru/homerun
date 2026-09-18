# Pull request previews

Tick **Pull request previews** on a git service's Source tab and every pull
request opened on its repo gets a service of its own, `<slug>-pr-<number>` (so
`<slug>-pr-<number>.<baseDomain>`), built from the pull request's head and
deployed as the service's owner. Each push to the pull request redeploys the
preview; closing or merging it deletes the preview, container, DNS records and
all. GitHub, Gitea and GitLab previews build the exact head commit; Bitbucket
only sends an abbreviated hash, so its previews build the head branch, which
covers every pull request previews are made for anyway.

**Pull requests from forks are never previewed.** On a public repo anyone can
open one, and a preview builds and runs its code with the service's env vars.
Homerun only previews a pull request whose head is positively the same
repository as its base (GitHub and Gitea compare the head and base repository,
GitLab the source and target project, Bitbucket the source and destination
repository); a fork, or a payload that doesn't say, is acknowledged and ignored.

A preview copies the service's build settings, env vars, resources, stack and
login wall when it's created and again on every update, but not its volumes,
domains, cron schedule or status checks. Previews are listed under the toggle,
and each is a normal service you can open, redeploy or delete (a push to its
pull request brings it back). Turning previews off, or deleting the service,
deletes every preview.

Previews ride on the same webhook as deploy on push: turning them on
re-registers the webhook to also send pull request events. A webhook added by
hand needs **Pull requests** (GitHub, Gitea), **Merge request events** (GitLab)
or the **Pull request** created, updated, merged and declined triggers
(Bitbucket) ticked too. Polling doesn't cover pull requests.
