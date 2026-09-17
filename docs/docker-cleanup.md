# Docker Cleanup

`/docker-cleanup` (admin-only) is `docker system df` and `docker system prune`
from the dashboard. **Unlike everything else in Homerun it is not scoped to
containers Homerun created**, that's the entire point of a cleanup tool: it can
see, and remove, anything on the host's Docker daemon.

The page previews what's actually reclaimable before you commit, unused images,
stopped containers, unreferenced volumes, unused networks (excluding Docker's
own three defaults and anything still attached), and unused build cache, with
the space each category would free. You can then prune each category on its own,
or use **Quick cleanup → Clean up now**, which prunes stopped containers,
dangling images, unused networks and build cache together, the same set as
`docker system prune`, and never touches volumes. Every action asks for
confirmation first.

- **Images** prunes only dangling images by default. Tick **Include tagged,
  unused images** to remove any image no container uses. The last few images of
  every service are kept either way, see
  [Revisions and rollback](revisions-and-rollback.md).
- **Networks** also offers **Reclaim orphaned stack networks**: the per-stack
  networks whose stack no longer exists, which Docker's own prune can't see
  while anything is still attached. A network with containers attached is left
  alone.

Two things worth knowing:

- **Pruning volumes deletes data.** An unreferenced Docker-managed volume is one
  no container currently mounts. A storage volume mounted into a Homerun service
  is always kept, even while that service is stopped or has no container at all,
  but a volume another tool created and no container uses is removed.
- **Pruning networks can remove the shared `homerun` network** once the last
  container detaches from it. That's harmless, Homerun recreates it on the next
  deploy rather than assuming it exists.

A cleanup runs through the same [job queue](scheduling.md#the-job-queue) as
deploys, and holds the queue while it runs, so it can't delete an image or build
cache out from under a deploy in flight.

## Image mirror

The **Image mirror** panel shows how much disk the `homerun-mirror` registry
[image scanning](image-scanning.md) copies images into is using, and **Clean up
mirror** garbage-collects it. The same cleanup runs on its own every day at
04:00 (postponed within that hour while a deploy or scan is queued or running).
It:

1. keeps, per service, the current `image:tag`, the digest of its last
   successful deploy and its last two scanned digests. An older kept version
   whose tag has moved on is re-tagged `homerun-keep-<digest>` so the next step
   doesn't sweep it;
2. deletes every other manifest through the registry API, which needs the
   registry started with `REGISTRY_STORAGE_DELETE_ENABLED=true`. A mirror
   created by an older Homerun without it is recreated once, its
   `homerun-mirror-data` volume stays;
3. runs `registry garbage-collect --delete-untagged` inside the container,
   removes the repositories nothing is left in, and restarts the registry so its
   in-memory blob cache doesn't claim a deleted layer still exists.

Like the other cleanups it is a queued job that holds the queue, and a deploy
that starts while it runs anyway skips the mirror and pulls directly. The job
result and the app log record how many manifests were deleted and the bytes
reclaimed.
