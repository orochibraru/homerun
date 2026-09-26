# Pull request previews

Tick **Enable pull request previews** on a git service's **Previews** tab and
every pull request opened on its repo gets a service of its own,
`<slug>-pr-<number>` (so `<slug>-pr-<number>.<baseDomain>`), built from the pull
request's head and deployed as the service's owner. Each push to the pull
request redeploys the preview; closing or merging it deletes the preview,
container, DNS records and all. GitHub, Gitea and GitLab previews build the
exact head commit; Bitbucket only sends an abbreviated hash, so its previews
build the head branch, which covers every pull request previews are made for
anyway.

**Pull requests from forks are never previewed.** On a public repo anyone can
open one, and a preview builds and runs its code with the service's env vars.
Homerun only previews a pull request whose head is positively the same
repository as its base (GitHub and Gitea compare the head and base repository,
GitLab the source and target project, Bitbucket the source and destination
repository); a fork, or a payload that doesn't say, is acknowledged and ignored.

A preview copies the service's build settings, env vars, resources, healthcheck,
stack and login wall when it's created and again on every update, but not its
volumes, domains, cron schedule or status checks. The Previews tab lists the
open ones with their status and domains, a **Redeploy** and a **Delete** button
(a push to its pull request brings a deleted one back), and a **Domains** link
to the preview's own Networking tab. Each preview is a normal service you can
open too. Previews aren't rows of their own on the services list or a stack's
page: each one is listed under the service it previews, in the list and in the
dependency tree, and searching for a preview's branch or title finds its parent.
A preview takes its parent's stack, icon and category. Any of the service's own
hostnames in its env vars (an `ORIGIN`, a public URL) are replaced with the
preview's main hostname, so a preview doesn't send its visitors, cookies or CSRF
checks to the real site. Turning previews off, or deleting the service, deletes
every preview.

## Domains

A preview gets `<slug>-pr-<number>.<baseDomain>` by default. A **domain
template** gives each one its own domain instead, or as well:

- `{pr}` is the pull request number: `pr-{pr}.preview.example.com`.
- `{branch}` is its branch as one DNS label, in lower case with anything that
  isn't a letter or digit turned into a dash: `feat/Login` gives `feat-login`.
- `{slug}` is the service's slug.

The template must contain `{pr}` or `{branch}`, so every preview gets a
different domain. Point a wildcard DNS record (`*.preview.example.com`) at the
host, or let the [DNS automation](dns-automation.md) create one record per
preview; either way Traefik gets a certificate per preview domain. A template
domain that another service already routes is skipped for that preview, which
keeps its default hostname.

**Keep the default hostname** decides whether previews still answer on
`<slug>-pr-<number>.<baseDomain>` alongside the template's domain. It stays on
regardless when there's no template, since a preview needs at least one domain.

Saving a changed template or default-hostname setting re-applies it to every
open preview right away: their domains and DNS records are replaced and the
deployed ones are redeployed so Traefik picks the new routes up. Domains added
by hand on a preview's Networking tab are replaced along with them.

Previews ride on the same webhook as deploy on push: turning them on
re-registers the webhook to also send pull request events. A webhook added by
hand needs **Pull requests** (GitHub, Gitea), **Merge request events** (GitLab)
or the **Pull request** created, updated, merged and declined triggers
(Bitbucket) ticked too. Polling doesn't cover pull requests.

Previews combine with [release channels](release-channels.md) on the same
service: pull requests get previews, the canary branch deploys the canary and
matching tags deploy the service itself. See
[Main is canary, tags are stable](main-canary-tags-stable.md).

## Testing previews from CI

`homerun previews wait <service> <pr> --commit <sha>` blocks until a pull
request's preview runs that commit and is healthy, then prints its URL, and
`homerun previews promote <service> <pr>` deploys the preview's exact image to
the service, with no rebuild. The same endpoints are under
`/api/v1/services/{id}/previews` (see [API & CLI](api-and-cli.md#previews)).
[Testing pull requests with GitHub Actions](github-actions-preview-testing.md)
puts them together: E2E tests against every preview, and shipping the image that
passed.
