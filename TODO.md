<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] One bun unit test failed once in the stop hook's `bun run test` (1619
      pass, 1 fail) and not in 16 reruns, three at a time included. The hook's
      output didn't name it: `.claude/hooks/gate.sh` keeps the last 40 lines
      matching `fail|error|threshold`, and the coverage table's `error-tracking`
      rows push the `(fail)` line out. Make the gate print `(fail)` lines first,
      then catch the test.

- [ ] `.markdownlint-cli2.jsonc` sets `"fix": true` and doesn't honour
      `.gitignore`, so any `markdownlint-cli2` run fixes in place, and one given
      a directory (`markdownlint-cli2 .`) rewrites every file under it as
      Markdown, `.git/` and `.env` included (tabs to spaces, `(x)[y]` to
      `[x](y)`, `#!` to `# !`). Drop `fix` from the config (`lint:fix` and the
      prek hook already pass `--fix`) and set `"gitignore": true`.

- [ ] `.claude/agents/repo-gate.md`, `scaffold-feature.md` and
      `subproject-sync.md` still say `$lib` and "SvelteKit 2"; update them to
      `#lib/...js` imports and SvelteKit 3.

- [ ] `src/app.html` declares `lang="fr"` while the whole UI is English, so
      screen readers read every page with French pronunciation. Set it to `en`.

## Medium

- [ ] The stack diagram's cards and substacks can only be rearranged by dragging
      with a pointer. Add a keyboard way to move the focused card (arrow keys
      while a "move" mode is on), saved like the dragged offsets.

## Large

<!--  -->
