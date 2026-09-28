# Notifications

The bell in the header is a per-account feed of lifecycle events on every
service, whoever created it (each account gets its own copy to read and clear),
deploy succeeded or failed, a build stopped by status checks, an unhealthy or
rolled back revision, service created, started, stopped, an auto-redeploy
firing, an image scan finding a critical vulnerability, and runtime errors
attributed to a service, plus the server crossing a resource limit. Click an
entry to jump to its service, mark everything read from the dropdown, or hover a
row and use the `x` to drop it.

Scheduled redeploys are grouped in the bell too: their outcomes are held until
90 seconds pass without another one (10 minutes at most), then show up as one "N
services were auto-redeployed: …" entry and one "N scheduled redeploys failed:
…" entry with each error. A single redeploy keeps its own entry.

It's deliberately a short curated list, not a log: everything Homerun logs at
warn or error level is persisted separately and shown on the relevant service's
[Observability tab](observability.md#errors). Old notifications are trimmed
automatically, so the feed doesn't grow without bound.

**Notification channels** send the same kind of events outside the dashboard.
Add a Discord webhook, a Slack incoming webhook, a Telegram bot, a generic
webhook, or an email address under **Notification Channels** in the sidebar,
then pick which events each one gets under **Profile → Notifications**: build
succeeded/failed, a build stopped by failing [status checks](status-checks.md),
scheduled update succeeded/failed, manual deploy succeeded/failed, a new
revision found unhealthy or [rolled back](revisions-and-rollback.md), an image
scan finding [critical vulnerabilities](image-scanning.md), a service going down
or recovering (from its [uptime probe](observability.md#uptime)), the server
crossing a [resource limit](dashboard.md) or recovering from one, a new or
regressed [error issue](error-tracking.md), a [volume backup](backups.md)
succeeding or failing (after its retry), and a [cron job](scheduling.md) run
succeeding or failing. A new channel starts subscribed to build and update
failures, status checks failures, unhealthy revisions, rollbacks, both resource
alerts, new and regressed errors, and backup and cron job failures; turn on the
rest you want from that matrix.

Notifications close together are grouped instead of arriving one by one. The
first one goes out straight away; any that follow within a minute of the
previous one are held and sent as a single message once a minute passes with
nothing new (five minutes at most), titled like
`3 notifications: 2 ok, 1 failed`, with one line per event and the error of each
failure. The outcomes of scheduled work (cron redeploys, scheduled backups and
cron jobs) are always held until every scheduled job still queued or running has
finished, retries included, then sent as one `Scheduled tasks: …` summary, so a
nightly run reports once (after an hour at most). A channel only ever gets the
events it subscribes to: when only one of a group's is left for it, it gets that
notification unchanged. Held notifications live in memory, so a restart while
they wait drops them.

A **Send test** button on each channel fires a sample notification so you can
check the destination actually works before relying on it. A delivery failure is
shown right on the channel rather than failing silently, and retried in the
background through the job queue: first after 30 seconds, then after 20, 40 and
80 more, four tries in all, visible as **Notification** jobs in the Scheduling
page's job queue. A retry is dropped once the channel is removed, disabled or
unsubscribed from that event, and a successful one clears the error. The test
button isn't retried. Email channels need SMTP configured first, see
[Configuration](configuration.md).

- **Slack**: create an
  [incoming webhook](https://api.slack.com/messaging/webhooks) for the channel
  and paste its `https://hooks.slack.com/services/…` URL.
- **Telegram**: create a bot with @BotFather, add it to the group or channel,
  then enter the bot token and the chat id (a number like `-1001234567890`, or a
  public channel's `@name`). The token is stored with the channel but never
  shown again, the list only shows the chat.
