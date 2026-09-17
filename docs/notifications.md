# Notifications

The bell in the header is a per-account feed of lifecycle events on every
service, whoever created it (each account gets its own copy to read and clear),
deploy succeeded or failed, a build stopped by status checks, an unhealthy or
rolled back revision, service created, started, stopped, an auto-redeploy
firing, an image scan finding a critical vulnerability, and runtime errors
attributed to a service. Click an entry to jump to its service, mark everything
read from the dropdown, or hover a row and use the `x` to drop it.

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
scan finding [critical vulnerabilities](image-scanning.md), and a service going
down or recovering (from its [uptime probe](observability.md#uptime)). A new
channel starts subscribed to build and update failures, status checks failures,
unhealthy revisions and rollbacks; turn on the rest you want from that matrix. A
**Send test** button on each channel fires a sample notification so you can
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
