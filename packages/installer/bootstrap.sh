#!/usr/bin/env bash
# The "single curl command" entry point:
#
#   curl -fsSL https://<host>/install.sh | sudo bash -s -- [--version=vX.Y.Z] [installer flags...]
#
# Every release publishes prebuilt agent/cli/installer binaries for
# linux/amd64 + linux/arm64 as GitHub release assets on this repo
# (.github/workflows/binaries.yaml + .releaserc.json), and pushes the app
# itself as a Docker image (.github/workflows/docker.yaml). This script just
# downloads the matching homerun-installer-<arch> binary and execs it :
# no Bun, no git, nothing built from source anywhere on the target host. See
# installer/README.md.
set -euo pipefail

GIT_HOST="github.com"
GIT_REPO="orochibraru/homerun"
VERSION="latest"

for arg in "$@"; do
	case "$arg" in
		--version=*) VERSION="${arg#--version=}" ;;
	esac
done

if [ "$(id -u)" -ne 0 ]; then
	echo "error: run as root (sudo bash -s -- ...) : the installer creates a system user and installs packages." >&2
	exit 1
fi

case "$(uname -s)" in
	Linux) ;;
	*)
		echo "error: this installs a Linux server (systemd + rootless Docker). Run it on the target server itself, not your workstation." >&2
		exit 1
		;;
esac

case "$(uname -m)" in
	x86_64 | amd64) ARCH="amd64" ;;
	aarch64 | arm64) ARCH="arm64" ;;
	*)
		echo "error: unsupported architecture $(uname -m) : release binaries only cover linux/amd64 and linux/arm64." >&2
		exit 1
		;;
esac

if [ "$VERSION" = "latest" ]; then
	DOWNLOAD_URL="https://${GIT_HOST}/${GIT_REPO}/releases/latest/download/homerun-installer-${ARCH}"
else
	DOWNLOAD_URL="https://${GIT_HOST}/${GIT_REPO}/releases/download/${VERSION}/homerun-installer-${ARCH}"
fi

BIN="$(mktemp)"
trap 'rm -f "$BIN"' EXIT

echo "Downloading homerun-installer-${ARCH} (${VERSION}) from ${GIT_HOST}/${GIT_REPO}..."
curl -fsSL "$DOWNLOAD_URL" -o "$BIN"
chmod +x "$BIN"

# All original args (including --version=, which the installer itself also
# reads to pick a matching agent binary / app image) are forwarded as-is.
exec "$BIN" "$@"
