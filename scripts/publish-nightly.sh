#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "::error::publish-nightly.sh failed at line $LINENO: $BASH_COMMAND" >&2' ERR

: "${VERSION:?VERSION is required}"
: "${SHA:?SHA is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

tag="v$VERSION"
keep=5
expected_assets=8

tag_sha() {
  gh api "repos/{owner}/{repo}/commits/$tag" --jq .sha 2>/dev/null || true
}

release_exists() {
  local output
  if output="$(gh release view "$tag" --json tagName 2>&1)"; then
    return 0
  fi
  if grep -q "release not found" <<<"$output"; then
    return 1
  fi
  echo "$output" >&2
  exit 1
}

if release_exists; then
  current="$(tag_sha)"
  if [ -n "$current" ] && [ "$current" != "$SHA" ]; then
    echo "$tag points at $current, not $SHA: recreating it"
    gh release delete "$tag" --cleanup-tag --yes
  fi
fi

if ! release_exists; then
  gh release create "$tag" --draft --prerelease --target "$SHA" \
    --title "Nightly $VERSION" \
    --notes "Nightly build of $SHA: prek passed, nothing else ran. It may be broken. Run it with HOMERUN_VERSION=nightly."
fi

bun scripts/upload-release-assets.ts "$tag" --prerelease

state="$(gh release view "$tag" --json isDraft,isPrerelease,assets \
  --jq '"\(.isDraft) \(.isPrerelease) \([.assets[] | select(.state == "uploaded")] | length)"')"
read -r draft prerelease assets <<<"$state"
if [ "$draft" != "false" ] || [ "$prerelease" != "true" ] || [ "$assets" -lt "$expected_assets" ]; then
  echo "::error::$tag isn't published correctly: draft=$draft prerelease=$prerelease assets=$assets/$expected_assets" >&2
  exit 1
fi

published="$(tag_sha)"
if [ "$published" != "$SHA" ]; then
  echo "::error::$tag points at ${published:-nothing}, expected $SHA" >&2
  exit 1
fi

mapfile -t stale < <(gh release list --limit 100 --json tagName,isPrerelease,createdAt \
  --jq "[.[] | select(.isPrerelease and (.tagName | contains(\"-nightly.\")))] | sort_by(.createdAt) | reverse | .[$keep:] | .[].tagName")
for old in "${stale[@]}"; do
  gh release delete "$old" --cleanup-tag --yes
done

echo "Published $tag at $SHA"
