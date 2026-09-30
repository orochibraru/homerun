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

## Medium

<!--  -->

## Large

<!--  -->
