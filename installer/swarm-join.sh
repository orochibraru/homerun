#!/usr/bin/env bash
# Joins this host to an existing Docker Swarm (as a worker, on a *rootless*
# Docker daemon dedicated to that swarm membership) and installs the
# Homerun Agent as a systemd --user service pointed at that same daemon.
#
# This is the bridge between Homerun's two host-integration primitives :
# Remote Hosts (this app talking to a separate Docker daemon over the
# Homerun Agent's HTTP API) and Swarm mode (instance-wide orchestration
# setting, see $lib/services/docker/swarm.ts) don't compose on their own :
# a swarm-mode service only ever deploys to the *local* swarm manager
# today (a real, documented limitation, see swarm.ts's own docstring),
# because a remote node has to actually be a member of the same swarm
# cluster, not just a separate daemon reachable by its own dockerode
# client. Running this script on that remote box, pointed at the manager's
# join token, is what makes it an actual swarm member.
#
# Single command:
#
#   curl -fsSL https://<host>/swarm-join.sh | sudo bash -s -- \
#     --token <SWMTKN-...> --manager <manager-ip>:2377 [--version=vX.Y.Z] [--user=homerun]
#
# Get the join token + manager address from the swarm manager itself:
#   docker swarm join-token worker
#
# Deliberately plain bash, not the TypeScript installer (installer/) : this
# is a narrower, standalone job (join + agent, not the full rootless-Docker-
# plus-app-stack flow bootstrap.sh drives), same "hand-roll a small thing
# rather than fight a mismatched tool" posture as this repo's other
# standalone scripts. Mirrors installer/steps/rootless-docker.ts and
# installer/steps/agent.ts's exact command sequences by hand so the two
# don't drift on how rootless Docker / the agent unit get set up.
set -euo pipefail

GITEA_HOST="git.ombrage.space"
GITEA_REPO="orochibraru/homerun"
VERSION="latest"
ROOTLESS_USER="homerun"
JOIN_TOKEN=""
MANAGER_ADDR=""

for arg in "$@"; do
	case "$arg" in
		--version=*) VERSION="${arg#--version=}" ;;
		--user=*) ROOTLESS_USER="${arg#--user=}" ;;
		--token=*) JOIN_TOKEN="${arg#--token=}" ;;
		--manager=*) MANAGER_ADDR="${arg#--manager=}" ;;
		--help | -h)
			sed -n '2,25p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*)
			echo "error: unknown argument: $arg (see --help)" >&2
			exit 1
			;;
	esac
done

if [ -z "$JOIN_TOKEN" ] || [ -z "$MANAGER_ADDR" ]; then
	echo "error: --token and --manager are both required. Run 'docker swarm join-token worker' on the manager to get them." >&2
	exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
	echo "error: run as root (sudo bash -s -- ...) : creates a system user, installs packages, writes systemd units." >&2
	exit 1
fi

case "$(uname -s)" in
	Linux) ;;
	*)
		echo "error: this sets up a Linux server (systemd + rootless Docker). Run it on the target server itself." >&2
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
	AGENT_URL="https://${GITEA_HOST}/${GITEA_REPO}/releases/latest/download/homerun-agent-${ARCH}"
else
	AGENT_URL="https://${GITEA_HOST}/${GITEA_REPO}/releases/download/${VERSION}/homerun-agent-${ARCH}"
fi

echo "==> Installing prerequisites"
if command -v apt-get >/dev/null 2>&1; then
	apt-get update -y
	apt-get install -y uidmap dbus-user-session curl
elif command -v dnf >/dev/null 2>&1; then
	dnf install -y shadow-utils curl
elif command -v yum >/dev/null 2>&1; then
	yum install -y shadow-utils curl
else
	echo "warning: unrecognized package manager, skipping uidmap/dbus-user-session/shadow-utils install : rootless Docker setup below may fail if they're missing." >&2
fi

echo "==> Installing Docker Engine (skipped if already present)"
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
fi

echo "==> Ensuring rootless-Docker user \"${ROOTLESS_USER}\""
if ! id "$ROOTLESS_USER" >/dev/null 2>&1; then
	useradd --create-home --shell /bin/bash "$ROOTLESS_USER"
fi

# Same three steps as installer/steps/rootless-docker.ts's installRootlessDocker :
# enable-linger (survive reboot with no active login), the rootless install
# itself (Docker's own documented flow), then enable+start the daemon.
loginctl enable-linger "$ROOTLESS_USER"
USER_UID="$(id -u "$ROOTLESS_USER")"
XDG_RUNTIME_DIR="/run/user/${USER_UID}"
ROOTLESS_SOCKET="${XDG_RUNTIME_DIR}/docker.sock"

echo "==> Installing rootless Docker for ${ROOTLESS_USER} (this can take a minute)"
runuser -u "$ROOTLESS_USER" -- env HOME="/home/${ROOTLESS_USER}" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
	sh -c "curl -fsSL https://get.docker.com/rootless | sh"

runuser -u "$ROOTLESS_USER" -- env HOME="/home/${ROOTLESS_USER}" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
	systemctl --user enable --now docker

echo "==> Joining swarm at ${MANAGER_ADDR}"
# Run as the rootless user, against *that* daemon specifically (DOCKER_HOST
# pointed at the rootless socket) : this app's remote-host/agent model is
# built around the rootless daemon being the one that runs deployed
# containers, so that's the daemon that needs to be the swarm member, not
# whatever root Docker (if any) happens to also be installed.
runuser -u "$ROOTLESS_USER" -- env HOME="/home/${ROOTLESS_USER}" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" DOCKER_HOST="unix://${ROOTLESS_SOCKET}" \
	docker swarm join --token "$JOIN_TOKEN" "$MANAGER_ADDR"

echo "==> Installing the Homerun Agent"
AGENT_BIN="/usr/local/bin/homerun-agent"
curl -fsSL "$AGENT_URL" -o "$AGENT_BIN"
chmod +x "$AGENT_BIN"

UNIT_DIR="/home/${ROOTLESS_USER}/.config/systemd/user"
TOKEN_FILE="/home/${ROOTLESS_USER}/.homerun-agent/token"
mkdir -p "$UNIT_DIR"
cat > "${UNIT_DIR}/homerun-agent.service" <<EOF
[Unit]
Description=Homerun Agent
After=docker.service
Wants=docker.service

[Service]
ExecStart=${AGENT_BIN}
Restart=on-failure
Environment=PORT=7420
Environment=DOCKER_SOCKET_PATH=${ROOTLESS_SOCKET}
Environment=AGENT_TOKEN_FILE=${TOKEN_FILE}

[Install]
WantedBy=default.target
EOF
chown -R "${ROOTLESS_USER}:${ROOTLESS_USER}" "$UNIT_DIR"

runuser -u "$ROOTLESS_USER" -- env HOME="/home/${ROOTLESS_USER}" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
	systemctl --user daemon-reload
runuser -u "$ROOTLESS_USER" -- env HOME="/home/${ROOTLESS_USER}" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
	systemctl --user enable --now homerun-agent

echo ""
echo "==> Done."
echo "This host is now a swarm worker, and the Homerun Agent is running on port 7420."
echo ""
echo "Note: today's Remote Hosts feature (Settings > Remote Hosts) talks to a"
echo "remote daemon directly, not through the Agent's HTTP API yet ; the Agent"
echo "primitive built here is groundwork for that, see agent/README.md. What"
echo "swarm mode itself needs from this host is just the swarm membership"
echo "above : once joined, deploy Homerun services from the main instance with"
echo "orchestration mode set to \"swarm\" (Settings > Orchestration), and Swarm"
echo "itself schedules tasks across every joined node, including this one."
echo ""
if [ -f "$TOKEN_FILE" ]; then
	sleep 2
	if [ -f "$TOKEN_FILE" ]; then
		echo "Agent token (also in ${TOKEN_FILE} on this host):"
		cat "$TOKEN_FILE"
		echo ""
	fi
fi
