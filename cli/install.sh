#!/usr/bin/env bash
# The "single curl command" way to install the homerun CLI:
#
#   curl -fsSL https://git.ombrage.space/orochibraru/homerun/raw/branch/main/cli/install.sh | bash
#
# Detects OS/arch, downloads the matching prebuilt homerun-cli-<arch> release
# binary (Linux amd64/arm64 only, see below), and installs it as
# /usr/local/bin/homerun so `homerun` just works afterward. No Bun, no git,
# nothing built from source. Same pattern as installer/bootstrap.sh.
set -euo pipefail

GITEA_HOST="git.ombrage.space"
GITEA_REPO="orochibraru/homerun"
VERSION="latest"
INSTALL_DIR="${HOMERUN_INSTALL_DIR:-/usr/local/bin}"

for arg in "$@"; do
	case "$arg" in
		--version=*) VERSION="${arg#--version=}" ;;
	esac
done

# Only Linux binaries are published (see scripts/build-packages.ts /
# .github/workflows/binaries.yaml) : macOS/Windows aren't targets for this
# app's own deploy host, and the CLI just talks to a running instance's REST
# API over HTTP, so building from source (`cli/README.md`) is the fallback
# there rather than adding cross-platform release builds for a thin client.
case "$(uname -s)" in
	Linux) ;;
	*)
		echo "error: prebuilt homerun CLI binaries are Linux-only (amd64/arm64). Build it from source instead, see cli/README.md." >&2
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
	DOWNLOAD_URL="https://${GITEA_HOST}/${GITEA_REPO}/releases/latest/download/homerun-cli-${ARCH}"
else
	DOWNLOAD_URL="https://${GITEA_HOST}/${GITEA_REPO}/releases/download/${VERSION}/homerun-cli-${ARCH}"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading homerun-cli-${ARCH} (${VERSION}) from ${GITEA_HOST}/${GITEA_REPO}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP"
chmod +x "$TMP"

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/homerun"
if [ -w "$INSTALL_DIR" ]; then
	mv "$TMP" "$DEST"
else
	echo "Installing to ${DEST} needs elevated permissions..."
	sudo mv "$TMP" "$DEST"
fi
trap - EXIT

echo "Installed homerun to ${DEST}."
case ":$PATH:" in
	*":${INSTALL_DIR}:"*) ;;
	*) echo "warning: ${INSTALL_DIR} isn't on your PATH, add it to run 'homerun' directly." >&2 ;;
esac

homerun --version
echo "Run 'homerun --help' to get started."
