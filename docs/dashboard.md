# The dashboard

`/` (Overview) is the landing page after sign-in:

- **Service counts**, how many services the instance has and how many are
  running.
- **Host resources**, live CPU, memory, disk and (if an NVIDIA card with
  `nvidia-smi` is present) GPU usage for the machine Homerun runs on, refreshed
  every five seconds. It loads behind a placeholder rather than blocking the
  page, so a slow `df` never holds the dashboard up. No card, or no
  `nvidia-smi`, just means the GPU block doesn't render, it isn't an error.
- **Resource usage history**, the same host CPU and memory as a chart, live or
  over the last hour, day, week, month, year or all of it, from a sample taken
  every minute and kept for a year, next to a **per-service usage** table of the
  five services using the most (sort it by CPU, memory or traffic). A stack's
  own page has the same table for its members, and a service's Overview tab has
  its own chart.
- **Recent deployments** across every service, each linking to the service it
  belongs to.
- **Recent errors**, the latest warn/error-level log lines, each linking to the
  service it mentions (or to System Logs when it mentions none). An admin sees
  the instance's most recent errors, including ones that mention no service; a
  developer only sees ones that mention a service.
- **Quick actions**, shortcuts to deploy a service and to the services list.
- **A setup-issues banner**, when applicable, see below.

## Search

The **Search…** button in the header, or `⌘K` / `Ctrl+K` anywhere, opens a
command palette. It jumps to any dashboard page by name, and once you've typed
two characters it also searches the instance's services, stacks, templates, cron
jobs, storage volumes, S3 destinations, remote hosts, build cache registries,
git providers, notification channels and status pages, plus users and
authentication providers for an admin.

## Setup diagnostics

Homerun runs a handful of read-only checks on every dashboard load: base domain,
Origin and auth secret still at their defaults, the Traefik container reachable,
the Docker socket reachable, and SMTP fully configured if you turned it on. Any
that aren't OK show up as a banner at the top of the dashboard.

The banner links straight into `/settings`, on whichever tab the offending field
lives, and rings the relevant fields so you can see what it's complaining about
rather than hunting for it. Two checks have nothing to deep-link to: the auth
secret is env-only (`AUTH_SECRET`, change it and restart), and the Traefik check
is about a live container rather than a setting.

There's no separate `/setup` page, the banner plus `/settings` is the whole
flow.
