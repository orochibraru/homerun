# Deploying

The Overview tab has Deploy/Start/Stop/Restart plus a live progress panel. The
panel shows six phases, resolving configuration, preparing volumes, fetching
image, provisioning container, routing traffic, ready, ticking off as they
complete, with the raw build/pull output streaming underneath. Progress arrives
over server-sent events (the server pushes each new line and status change; if
that stream can't be held open, the panel falls back to polling), and it resumes
correctly if you reload the page mid-deploy, or if the deploy was started
somewhere else entirely (a template quick-deploy, cron). Below it sit a
**Resource usage** chart for the service's own container (CPU, memory and
network traffic, live or over the last hour, day, week, month, year or all of
it, sampled every minute), a **Connections** panel listing the services it
references through env vars and the ones that reference it, and a tail of its
live logs. Deployment history, every attempt with its status, image and full
log, is on the [Revisions](revisions-and-rollback.md) tab.

**Redeploys are health-gated.** When the service already has a running
container, the new one starts next to it and the old one keeps serving until the
new one is ready; then the old container is removed. If the new container exits,
restarts, reports unhealthy or isn't ready within 5 minutes, it's removed
instead, its last log lines go into the deploy log, the deploy is marked failed
and the old container carries on untouched. Two cases stop the old container
first: **host networking** (both copies would bind the same ports) and a
**writable volume** (two copies writing the same data, a database's data
directory for instance). In [swarm mode](swarm-mode.md) the service is updated
in place through swarm's own rolling update, start-first, and swarm rolls back
to the previous tasks on its own when a new one fails.

**Readiness: no traffic before the new copy is ready.** Like a Kubernetes
readiness probe, a new container or swarm task gets no traffic from Traefik
until its readiness check passes. Both are built on Docker's healthcheck:
Traefik skips a container whose health isn't `healthy` yet, and swarm keeps a
task out of `running` (so out of Traefik and out of the service's own DNS) until
its healthcheck passes. The deploy log says which check applies:

- the service's **healthcheck command**, when set;
- otherwise the image's own `HEALTHCHECK`;
- otherwise a check Homerun adds itself, which passes once something in the
  container listens on the container port (on any address but loopback). It only
  needs `/bin/sh` in the image, not curl, wget or nc, and after a crash or a
  restart it holds traffic back again until the port is listening.

A healthcheck is readiness and liveness at once: after the first pass it keeps
running every 30 seconds, and three failures in a row mark the container
unhealthy, which takes it out of Traefik, fails the revision's health watch, and
in swarm mode gets the task replaced. Homerun's own listening check is ignored
by the uptime probe, which keeps probing the port over HTTP or TCP.

There's no readiness gate, and the new copy gets traffic as soon as it runs,
when the port is UDP only or the image has neither a healthcheck nor `/bin/sh`
(`scratch` and distroless images). Add a `HEALTHCHECK` to such an image for a
real gate. A standalone container then shares traffic with the old one from the
moment it starts, and counts as ready after running 5 seconds. A swarm task is
worse off: swarm stops the old task as soon as the new one runs, so requests
fail until the new one listens. Services that aren't published through Traefik
(not DNS-resolvable, host networking) have no traffic to hold back. Other
services reaching this one by its slug on the Docker network aren't gated in
standalone mode: Docker's DNS resolves the name to the new container as soon as
it starts. In swarm mode the service name only resolves to tasks that passed
their healthcheck.

**Requests racing a removed copy are retried.** Every published service's router
carries a retry middleware: a request that reaches a container or swarm task
that just went away, before Traefik has dropped it, is retried on another copy,
up to four times with a short backoff. Traefik only retries when nothing of the
request reached the app, so a form post is never sent twice. Traefik reads swarm
every 2 seconds rather than reacting to events, which is how long an old task
can stay in its list; the retry covers that window.

Clicking Deploy **queues** the deploy rather than running it inside the request
(see [The job queue](scheduling.md#the-job-queue)), so the button comes back
immediately and the progress panel narrates the rest. Same for "Create and
Deploy" at the end of the new-service wizard: it creates the service, queues the
deploy, and drops you straight on the service page watching it come up.
