# TODO

The backlog, and the only one. `Small`/`Medium`/`Large` are rough size, not
priority : there is no priority ordering, pick whatever. When done delete the
entry, no bloat.

## Not prioritized / No size / Too lazy to size just got an idea

## Small

- [ ] [App] **Verify the Dokploy migration against the live instance.**
      `/services/migrate` is built and unit-tested against Dokploy's documented
      shapes, but never run against a real one : the field names per entry type
      (`applicationId`/`composeId`/`dockerImage`/`env`) and whether
      `/api/project.all` answers a bare array or a `result.data` wrapper are the
      two things a real token would settle in one click.

## Medium

## Large

- [ ] [App] **Self-update from the sidebar.** Print the version in the sidebar
      from `package.json` (computed in CI by semantic-release before the build),
      compare it to the latest GitHub release on page load, and surface a notice
      when a newer one exists. Clicking it opens a modal that checks no
      deployments are queued, then starts the update sequence: hold the worker
      for all deployments and actions, then start an update worker that stops
      the main app, pulls its latest image and brings it back up.
- [ ] [Auth] **Passkey and 2FA on the auth pages**, plus instance-level policies
      to require them. The plugin and client are already wired
      (`@better-auth/passkey`), nothing in `src/routes` uses them.
- [ ] [Refactor] **Make the legal deploy combinations a union.**
      `deploy.service.ts` is ~600 lines over `buildSource` x `buildTarget.kind`
      x `orchestrationMode`. Most combinations are illegal and only rejected by
      a `throw` at the end of the pipeline, which is how the autoscale/swarm bug
      happened.
- [ ] [Tooling] **Homerun SDK**, a shared library with the CLI.
- [ ] [SDKs] **Terraform and Pulumi providers.**
- [ ] [Docker] **Image security scanning.**
