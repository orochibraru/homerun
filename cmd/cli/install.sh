#!/usr/bin/env bash
# The "single curl command" way to install the homerun CLI:
#
#   curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/cmd/cli/install.sh | bash
#
# Detects OS/arch, downloads the matching prebuilt homerun-cli-<arch> release
# binary (Linux amd64/arm64 only, see below), and installs it as
# /usr/local/bin/homerun so `homerun` just works afterward. No Bun, no git,
# nothing built from source. Same pattern as installer/bootstrap.sh.
set -euo pipefail

GIT_HOST="github.com"
GIT_REPO="orochibraru/homerun"
VERSION="latest"
INSTALL_DIR="${HOMERUN_INSTALL_DIR:-/usr/local/bin}"

for arg in "$@"; do
	case "$arg" in
		--version=*) VERSION="${arg#--version=}" ;;
	esac
done

case "$(uname -s)" in
	Linux) PLATFORM="" ;;
	Darwin) PLATFORM="darwin-" ;;
	*)
		echo "error: prebuilt homerun CLI binaries cover Linux and macOS only, not $(uname -s)." >&2
		exit 1
		;;
esac

case "$(uname -m)" in
	x86_64 | amd64) ARCH="${PLATFORM}amd64" ;;
	aarch64 | arm64) ARCH="${PLATFORM}arm64" ;;
	*)
		echo "error: unsupported architecture $(uname -m) : release binaries only cover amd64 and arm64." >&2
		exit 1
		;;
esac

if [ "$VERSION" = "latest" ]; then
	DOWNLOAD_URL="https://${GIT_HOST}/${GIT_REPO}/releases/latest/download/homerun-cli-${ARCH}.gz"
else
	DOWNLOAD_URL="https://${GIT_HOST}/${GIT_REPO}/releases/download/${VERSION}/homerun-cli-${ARCH}.gz"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading homerun-cli-${ARCH} (${VERSION}) from ${GIT_HOST}/${GIT_REPO}..."
curl -fsSL "$DOWNLOAD_URL" | gunzip -c > "$TMP"
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

"$DEST" --version
echo "Run 'homerun --help' to get started."
