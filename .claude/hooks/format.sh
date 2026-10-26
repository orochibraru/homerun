#!/usr/bin/env bash
set -euo pipefail

file="$(jq -r '.tool_input.file_path // empty')"

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc | *.css | *.svelte | *.html | *.md | *.yaml | *.yml)
    bun fmt --cwd "$CLAUDE_PROJECT_DIR" --ignore-unknown --no-error-on-unmatched-pattern "$file"
    ;;
esac
