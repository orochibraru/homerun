# Observability

The **Observability** tab is where a service tells you whether it's healthy:
uptime probes, live logs, failed deploys and the errors Homerun logged about it.

## Uptime

Every minute Homerun probes each deployed service two ways, and the tab draws
the recent results as two heartbeat strips with an uptime percentage, latency,
and the reason for the latest failure plus hints for fixing it:

- **From the network**: the container's own port, reached over the Docker
  network. It runs the service's [healthcheck command](services.md#settings)
  when it has one, opens a TCP connection for a database image, and makes an
  HTTP request otherwise.
- **From its hostname**: the public hostname Traefik publishes
  (`<slug>.<base domain>` or the custom domain). It's skipped for a service that
  isn't DNS-resolvable, and while the base domain is a loopback address like
  `localhost`, since probing it from this machine proves nothing.

A probe that changes from up to down, or back, fires the **Service down** or
**Service recovered** event on any [notification channel](notifications.md)
subscribed to it. Results are kept for a week; **Clear heartbeats** empties the
history. Uptime also feeds [status pages](status-pages.md).

Probing is on for every service by default. **Turn off** in the Uptime panel's
header stops both probes for that service (the panel then says so), **Turn on**
resumes them; the REST API takes the same switch as `uptimeEnabled` on
`PATCH /api/v1/services/:id`.

## Logs

The log panel live-streams a running container's stdout/stderr straight from the
browser: the server pushes each line as the container writes it over a long-
lived HTTP response, no polling and no WebSocket (SvelteKit 2 has no WebSocket
route API; nothing here needs a client-to-server socket anyway). A shorter tail
of the same viewer is on the Overview tab once a service has deployed at least
once, so recent output is visible without switching tabs.

## Errors

Below the logs, **Failed deployments** and **Application errors** (persisted
warn/error-level app log lines that mention this service) sit alongside a
"container currently down" banner when the container has crashed. A deploy that
reaches running hides the errors logged before it, and **Clear errors** does the
same by hand; a note says how many are hidden and what cleared them, with a link
to show them again. If a service's container was removed outside Homerun (e.g. a
manual `docker rm`), the tab shows a distinct "container is gone" banner with a
**Resolve** button instead: click it to clear the stale reference so the service
goes back to its normal never-deployed state and Deploy works again.

## Terminal

An interactive `/bin/sh` into the live container, from the browser, only
available while the service is `running`. Open/close events are logged;
individual keystrokes/commands are not (that's a deliberate scope cut, not an
oversight, raw TTY bytes don't map cleanly to discrete commands anyway).
