# Image scanning

Every deploy scans the image for known vulnerabilities with
[Trivy](https://trivy.dev) before the workload starts. It's on by default and
never enforced unless you ask for it.

For an image-based service the pull goes through a registry mirror Homerun runs
for itself, `homerun-mirror` (a `registry:2` container on the shared network,
data in the `homerun-mirror-data` volume, published on `127.0.0.1:5055` only).
The deploy:

1. copies the image from its registry into the mirror with a throwaway
   [skopeo](https://github.com/containers/skopeo) container, using the service's
   registry credentials if it has any, without pulling it onto the host first;
2. scans the copy in the mirror with a throwaway Trivy container (the
   vulnerability database is cached in the `homerun-trivy-cache` volume, so only
   the first scan downloads it);
3. pulls the scanned image from `127.0.0.1:5055` onto the host and tags it with
   its usual name, so the container runs exactly what was scanned. On rootless
   Docker, whose daemon can't reach that loopback port, and whenever that pull
   fails, a throwaway skopeo container streams the scanned image out of the
   mirror straight into the daemon (`docker load`) instead.

In [swarm mode](swarm-mode.md) the other nodes can't reach a loopback mirror, so
the service is deployed from the upstream registry pinned to the scanned digest
(`image:tag@sha256:...`) instead.

The mirror is created the first time it's needed. If the copy into the mirror
fails, the deploy log says why and the deploy falls back to a normal pull, then
scans the image on the host through the Docker socket; if the scanned image
can't be pulled or loaded out of the mirror, it's pulled from its registry. A
pull policy that skips the pull scans the image already on the host. Git-built
images are scanned once built: on the host for a local build, in the build cache
registry (falling back to the host) for a build server with one, on the host for
a build server without one.

The mirror is garbage-collected every day at 04:00, and on demand from
[Docker Cleanup](docker-cleanup.md#image-mirror). For every service it keeps the
image the service currently points at, the digest its last successful deploy
ran, and its last two scanned versions (so a rollback or a rescan still finds
them); everything else goes, including images of deleted services.

The deploy log gets a summary line with counts per severity and the first few
CRITICAL/HIGH findings. The service's **Security** tab shows the latest scan,
the severity counts, the findings (top 200, most severe first, with the fixed
version when there is one), the scan history, and a **Scan now** button that
queues a scan of the deployed image. A scan that finds a CRITICAL vulnerability
adds a bell notification and fires the **Critical vulnerabilities** event on any
notification channel subscribed to it. The same scans are in the
[REST API and CLI](api-and-cli.md#image-scans), including a
`homerun services scan <id> --fail-on high` for failing a CI job on findings.

Scanning is controlled in two places:

- **Settings → Docker → Image scanning**, admin-only: turn it off for every
  service, and set the deploy block policy (see below).
- **Scan this service's image** on a service's Settings tab, to opt one service
  out. An opted-out service pulls straight from its registry, and the block
  policy doesn't apply to it.

## Blocking deploys on findings

**Block deploys at severity** turns scanning from a report into a gate. Pick
`Off` (the default), `Critical`, `High and above`, `Medium and above` or
`Low and above`: a deploy fails if the image has at least one finding at or
above that severity. Findings of unknown severity never block. Tick **Only block
on fixable vulnerabilities** to count only findings that have a fixed version,
so a CVE with no upstream fix yet stays visible on the Security tab without
stopping every deploy.

When the policy blocks a deploy:

- the image is checked before the new workload starts, so the container (or
  swarm service) that was already running keeps running untouched. With the
  mirror, a blocked image never reaches the host at all; a git-built image is
  built (and, with a build server, pushed to the build cache registry) but never
  started;
- the deploy log gets the scan summary and a line naming the policy, the
  blocking counts per severity and the full scan's counts:

  ```text
  Blocked by the image scan policy (block at HIGH or above):
  3 vulnerabilities at or above the threshold (1 critical, 2 high).
  Full scan: 1 critical, 2 high, 14 medium, 3 low, 0 unknown.
  ```

- the deployment is marked failed with that message, and the usual **Deploy
  failed** bell notification and notification-channel event fire (plus
  **Critical vulnerabilities** if any were critical).

The policy applies to every deploy path that builds or pulls an image: the
Deploy button, the API and CLI, scheduled redeploys, git pushes, and stack or
template deploys. A scanner that can't run (no network for the database, a
registry it can't read) doesn't block by default: the deploy goes ahead and the
failed scan is recorded. Tick **Fail deploys when the image can't be scanned**
under Settings → Docker → Image scanning to fail those deploys instead, with the
previous container left running. [Rollbacks](revisions-and-rollback.md) aren't
re-scanned or re-checked, since they redeploy an image that already ran here and
auto-rollback has to be able to recover a broken service.

The service's **Security** tab shows the current policy and whether its latest
scan passes it, so you can see before the next deploy whether it would be
blocked.
