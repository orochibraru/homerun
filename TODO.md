<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Standalone mode still stops a routed service's only container before
      starting the new one when it has a writable volume (`RolloutStrategy`), so
      its redeploys 404 for the gap; swarm mode now starts first for routed
      services, apply the same rule there.
- [ ] Syntax highlighting in the volume file browser's file view.
- [ ] Templates can publish ports (`publishedPorts` in the template file, table
      and form), so Gitea's and GitLab's templates can expose SSH for git out of
      the box.
- [ ] Integration/E2E bootstrap always `docker pull`s `postgres:18-alpine`, so a
      Docker Hub rate limit fails the run even with the image already local:
      fall back to the local image when the pull fails.
- [ ] `ui-registry.spec.ts` expects "The registry isn't answering", so it fails
      locally whenever the dev `homerun-mirror` container is running: point the
      E2E app at a registry address nothing listens on.

## Medium

<!--  -->

## Large

<!--  -->
