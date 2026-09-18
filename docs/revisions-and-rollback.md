# Revisions and rollback

Every deploy that reaches running is a **revision**: the exact image it ran
(`image:tag` plus the registry digest when there is one, or the local
`homerun-build-<slug>:<tag>` for a git build), the commit and branch for a git
build, and whether it stayed healthy. The **Revisions** tab lists them with the
current one marked, next to failed attempts and their logs.

The list is in the order revisions were first deployed and deploying one never
moves it: a rollback to an existing revision updates that revision's row in
place, which becomes **Current** and shows when it was redeployed, and its
expandable log, status and error are the latest attempt's (a failed rollback
shows its error there while the revision that's still running stays Current).
The API and CLI list revisions the same way.

The **Healthy** and **Checking health** badges only ever sit on the current
revision: once another revision is deployed they're cleared from the one it
replaced. **Unhealthy** and **Rolled back** stay on the revision as history.

**Deploy this revision** (confirmed in a dialog, also
`POST /api/v1/services/:id/revisions/:revisionId/deploy` and
`homerun services rollback`) queues a deploy that skips the build, the registry
pull and the image scan, and starts that exact image: by digest for a pulled
image (pulled again by digest if it was removed from the host), or the retained
local build for a git service. The service's image and tag are set back to the
revision's, so a later redeploy starts from there. By default only the image is
rolled back and environment variables, volumes, networking and resources stay
the service's current ones, since those are usually edited deliberately.

Tick **Also restore env vars, resources and networking** in the confirm dialog
(`?restoreConfig=true` on the API, `--restore-config` on the CLI) to put back
what that revision ran with as well: its environment variables, CPU and memory
limits, replicas, container port and protocol, network mode and whether it's
publicly routed, plus its [runtime options](runtime-and-compute.md#runtime).
Every deploy records those on its revision, so this works for any revision
deployed since the option existed; an older one logs that it has nothing to
restore and rolls back the image only. Volumes and domains are never rolled
back. The restored values are written onto the service, so the next deploy keeps
them. Auto-rollback only rolls back the image.

The last 5 distinct images of every service are **retained** (change the count,
from 1 to 50, under **Settings → Docker → Retained images**): Docker Cleanup's
image prune (including **Quick cleanup**) and the image mirror cleanup skip
them, so rolling back to any of them never needs a rebuild. Older revisions stay
listed but may need their image pulled or rebuilt.

**Auto-rollback.** After each deploy the new workload is watched for 90 seconds,
longer while its healthcheck is still starting (up to 5 minutes). It's unhealthy
when the container exits, restarts twice or more, or its Docker healthcheck
(including the service's own healthcheck command) reports unhealthy, or for a
swarm service when two tasks fail or not every replica is running. An unhealthy
revision is always marked on the Revisions tab and reported (**Revision
unhealthy**), and the reason is kept on the revision, so
`homerun services revisions <id>` shows it too. With **Auto-rollback when a new
revision is unhealthy** turned on in the service's Settings tab (off by
default), Homerun instead redeploys the previous healthy revision with a
different image, marks the new one as rolled back and sends **Rolled back**. A
rollback that is itself unhealthy isn't rolled back again.
