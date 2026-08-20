#!/usr/bin/env bash
# The "single curl command" entry point:
#
#   curl -fsSL https://<host>/install.sh | bash -s -- --repo=https://github.com/you/homerun.git
#
# There's no prebuilt-binary release feed yet (no CI publishing dist/
# artifacts anywhere) — this bootstraps Bun if it's missing, then clones the
# repo and runs the real installer (installer/src/index.ts) via `bun run`,
# which builds/installs the Homerun Agent (or the full stack, --mode=full)
# from that same checkout. Once release infra exists, this can be swapped
# for "download the right prebuilt installer/homerun-install-<arch> binary
# and exec it" instead — see installer/README.md.
set -euo pipefail

REPO_URL="${HOMERUN_REPO_URL:-}"
for arg in "$@"; do
	case "$arg" in
		--repo=*) REPO_URL="${arg#--repo=}" ;;
	esac
done

if [ -z "$REPO_URL" ]; then
	echo "error: --repo=<git url> is required (or set HOMERUN_REPO_URL)." >&2
	exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
	echo "error: run as root (sudo bash -s -- ...) — the installer creates a system user and installs packages." >&2
	exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
	echo "Bun not found, installing it first..."
	curl -fsSL https://bun.sh/install | bash
	export PATH="$HOME/.bun/bin:$PATH"
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

git clone --depth 1 "$REPO_URL" "$WORKDIR/homerun"
cd "$WORKDIR/homerun/installer"
bun install
exec bun run src/index.ts "$@"
