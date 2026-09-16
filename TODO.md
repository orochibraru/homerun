# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

- [ ] **[WIP]** [Docker] Garbage-collect the `homerun-mirror` registry, it keeps
      every image version ever deployed.
- [ ] [App] For git builds, require status checks to pass before
      building/deploying. Pull from git provider API which CI jobs exist and if
      any selected doesn't pass send a notification through configured channels
      to inform user build will not carry on.
- [ ] [App] Store built revisions, ability to deploy a revision (rollback).
      Enable auto-rollback if new revision is unhealthy (disabled by default in
      service settings)
