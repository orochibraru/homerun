#!/usr/bin/env bash
set -euo pipefail

GIT_HOST="github.com"
GIT_REPO="orochibraru/homerun"
VERSION="latest"
AGENT_USER="homerun"
JOIN_TOKEN=""
MANAGER_ADDRESS=""
ADVERTISE_ADDRESS=""

usage() {
	cat <<'EOF'
Joins this host to an existing Homerun swarm as a worker, then installs the
Homerun Agent on it.

  curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/cmd/installer/swarm-join.sh \
    | sudo bash -s -- --token=<SWMTKN-...> --manager=<manager-ip>:2377

Get the token and address on the manager with: docker swarm join-token worker

Options:
  --token=<token>           Worker join token (required)
  --manager=<ip>:2377       Manager address (required)
  --advertise-addr=<ip>     Address other nodes reach this one at, needed when
                            this host has several network interfaces
  --version=<tag>           Release the agent is installed from (default: latest)
  --user=<name>             Rootless user the agent runs as (default: homerun)

The swarm runs on the system (rootful) Docker daemon: rootless Docker can't
create the overlay networks swarm services use. Nodes must reach each other on
2377/tcp, 7946/tcp+udp and 4789/udp.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--version=*) VERSION="${1#--version=}" ;;
		--version)
			VERSION="${2:?error: --version requires a value}"
			shift
			;;
		--user=*) AGENT_USER="${1#--user=}" ;;
		--user)
			AGENT_USER="${2:?error: --user requires a value}"
			shift
			;;
		--token=*) JOIN_TOKEN="${1#--token=}" ;;
		--token)
			JOIN_TOKEN="${2:?error: --token requires a value}"
			shift
			;;
		--manager=*) MANAGER_ADDRESS="${1#--manager=}" ;;
		--manager)
			MANAGER_ADDRESS="${2:?error: --manager requires a value}"
			shift
			;;
		--advertise-addr=*) ADVERTISE_ADDRESS="${1#--advertise-addr=}" ;;
		--advertise-addr)
			ADVERTISE_ADDRESS="${2:?error: --advertise-addr requires a value}"
			shift
			;;
		--help | -h)
			usage
			exit 0
			;;
		*)
			echo "error: unknown argument: $1 (see --help)" >&2
			exit 1
			;;
	esac
	shift
done

if [ -z "$JOIN_TOKEN" ] || [ -z "$MANAGER_ADDRESS" ]; then
	echo "error: --token and --manager are both required. Run 'docker swarm join-token worker' on the manager to get them." >&2
	exit 1
fi

case "$MANAGER_ADDRESS" in
	*:*) ;;
	*) MANAGER_ADDRESS="${MANAGER_ADDRESS}:2377" ;;
esac

if [ "$(uname -s)" != "Linux" ]; then
	echo "error: this sets up a Linux server (systemd + Docker). Run it on the node itself." >&2
	exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
	echo "error: run as root (sudo bash -s -- ...): installs Docker, joins the swarm and installs the agent." >&2
	exit 1
fi

case "$(uname -m)" in
	x86_64 | amd64) ARCH="amd64" ;;
	aarch64 | arm64) ARCH="arm64" ;;
	*)
		echo "error: unsupported architecture $(uname -m): release binaries only cover linux/amd64 and linux/arm64." >&2
		exit 1
		;;
esac

if [ "$VERSION" = "latest" ]; then
	INSTALLER_URL="https://${GIT_HOST}/${GIT_REPO}/releases/latest/download/homerun-installer-${ARCH}.gz"
else
	INSTALLER_URL="https://${GIT_HOST}/${GIT_REPO}/releases/download/${VERSION}/homerun-installer-${ARCH}.gz"
fi

echo "==> Installing Docker Engine (skipped if already present)"
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Joining the swarm at ${MANAGER_ADDRESS}"
SWARM_STATE="$(docker info --format '{{.Swarm.LocalNodeState}}')"
if [ "$SWARM_STATE" = "active" ]; then
	echo "Already part of a swarm, skipping the join. Run 'docker swarm leave' first to join a different one."
else
	JOIN_ARGUMENTS=(swarm join --token "$JOIN_TOKEN")
	if [ -n "$ADVERTISE_ADDRESS" ]; then
		JOIN_ARGUMENTS+=(--advertise-addr "$ADVERTISE_ADDRESS")
	fi
	docker "${JOIN_ARGUMENTS[@]}" "$MANAGER_ADDRESS"
fi

echo "==> Installing the Homerun Agent (homerun-installer --mode=agent)"
INSTALLER_BINARY="$(mktemp)"
trap 'rm -f "$INSTALLER_BINARY"' EXIT
curl -fsSL "$INSTALLER_URL" | gunzip -c > "$INSTALLER_BINARY"
chmod +x "$INSTALLER_BINARY"
"$INSTALLER_BINARY" --mode=agent --yes "--version=${VERSION}" "--user=${AGENT_USER}"

echo ""
echo "==> Done."
echo "This host is a swarm worker: swarm-mode services deployed from Homerun can now be scheduled here."
echo "The Homerun Agent runs on port 7420 if you also want to register this host as a build server."
