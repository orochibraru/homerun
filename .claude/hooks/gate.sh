#!/usr/bin/env bash
set -uo pipefail

cd "$CLAUDE_PROJECT_DIR"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

gate() {
  local name="$1"
  shift
  if ! "$@" >"$log" 2>&1; then
    {
      echo "$name failed, fix it before handing back: $*"
      grep -E "error|Error|FAIL|fail|✖|below|threshold" "$log" | grep -v -E "^\s*$" | tail -40
      echo "--- last lines ---"
      tail -40 "$log"
    } >&2
    exit 2
  fi
}

gate "Type check" bun run check
gate "prek" prek run
gate "Unit tests (coverage threshold included)" bun run test
