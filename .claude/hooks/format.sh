#!/usr/bin/env bash
set -euo pipefail

file="$(jq -r '.tool_input.file_path // empty')"
bin="$CLAUDE_PROJECT_DIR/node_modules/.bin"

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc | *.css | *.svelte | *.html)
    "$bin/biome" check --write --no-errors-on-unmatched --files-ignore-unknown=true "$file"
    ;;
  *.md)
    "$bin/prettier" --log-level warn --write "$file"
    ;;
esac
