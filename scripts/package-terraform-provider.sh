#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: scripts/package-terraform-provider.sh <version> [binaries dir] [output dir]" >&2
  exit 1
fi

version="${1#v}"
binaries="$(cd "${2:-dist}" && pwd)"
output="${3:-$binaries/terraform-provider}"
name="terraform-provider-homerun"
prefix="${name}_${version}"

rm -rf "$output"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

files=()
for target in amd64:linux_amd64 arm64:linux_arm64 darwin-amd64:darwin_amd64 darwin-arm64:darwin_arm64; do
  binary="${name}_v${version}"
  archive="${prefix}_${target#*:}.zip"
  install -m 755 "$binaries/homerun-terraform-provider-${target%%:*}" "$staging/$binary"
  (cd "$staging" && zip -q -X "$output/$archive" "$binary")
  rm "$staging/$binary"
  files+=("$archive")
done

printf '{"version":1,"metadata":{"protocol_versions":["6.0"]}}\n' >"$output/${prefix}_manifest.json"
files+=("${prefix}_manifest.json")

cd "$output"
shasum -a 256 "${files[@]}" >"${prefix}_SHA256SUMS"
gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --detach-sign --output "${prefix}_SHA256SUMS.sig" "${prefix}_SHA256SUMS" \
  <<<"${TERRAFORM_PROVIDER_GPG_PASSPHRASE:-}"

ls -1 "$output"
