# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Run the Cloudflare DNS automation against a real account and fix what
      breaks. Pangolin's half ran live against `homelab` (site
      `homerun-live-test`, `chibre.space`) and passes; Cloudflare needs a token.

## Medium

- [ ] **[WIP]** Share a PR preview with a client: the app-access-only role and
      `/my-apps` landed; the preview access policy didn't (edits to
      `service-dto.ts`, `service-input.ts` and `schema.ts` were refused by the
      permission system). Still needed: `previewAuth*` columns + migration, DTO
      defaults/getters/update input, apply the parent's preview policy in
      `PreviewService#create`/`#refresh` (not in `mirroredSettings`, the canary
      keeps the parent's own wall), `applyAuth` re-apply + redeploy, the
      Previews-tab form, docs, tests; add `"app-user"` to `UserRole` and drop
      the cast in `InvitationDTO.create`.
- [ ] Preview promote rides on the rollback path, so the deployment history
      labels it "Rollback" and auto-rollback never fires on a promoted deploy:
      give it its own `promote` trigger and let auto-rollback watch it.
- [ ] Release channels: exercise against a real provider (tag push to stable,
      branch push to canary), open the Channels tab in a browser, and add a test
      for canary branch polling; a custom environment name isn't settable
      anywhere yet.
- [ ] Preview "unhealthy while healthy" with several domains (sergios.fr PR #4):
      its current revision reads `healthy` and both hostnames answer, so it
      didn't reproduce; need where the Unhealthy label showed (revision, uptime,
      overview) next time it happens.

- [ ] Backfill `service_dependency` rows from existing env-var links (links made
      before the table existed give no start order until re-linked), and expose
      dependencies in the REST API and MCP.
- [ ] Browser-check the xterm.js Terminal tab (vim, top, resize, dark mode).

- [ ] The aiostreams template restart-loops on its placeholder `SECRET_KEY` (not
      64 hex chars): generate it like the other `{{secret}}` passwords, then
      drop it from the template E2E skip list.

## Large

<!--  -->
