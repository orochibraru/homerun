/** The release tag a server installs the agent from: this instance's own, so the two stay in step. */
export function releaseTagFor(version: string): string {
	return /^\d+\.\d+\.\d+/.test(version) ? `v${version}` : "latest";
}

/**
 * The command an admin runs on a fresh server to enroll it,
 * piping the install script into bash with the one-time token.
 */
export function enrollCommand(origin: string, token: string): string {
	return `curl -fsSL ${origin}/api/v1/nodes/install.sh | sudo bash -s -- --token=${token}`;
}

/**
 * The shell script `GET /api/v1/nodes/install.sh` serves. It installs Docker,
 * joins this instance's swarm and/or installs the worker in agent mode
 * (whichever the enrollment asks for, the server decides), and reports back
 * to `POST /api/v1/nodes/enroll`. It asks the enrollment endpoint for its
 * plan first, so the token alone decides what the server becomes.
 */
export function nodeInstallScript(origin: string, version: string): string {
	return `#!/usr/bin/env bash
set -euo pipefail

HOMERUN_URL="${origin}"
VERSION="${releaseTagFor(version)}"
TOKEN=""
ADDRESS=""
AGENT_USER="homerun"
AGENT_PORT="7420"

while [ $# -gt 0 ]; do
	case "$1" in
		--token=*) TOKEN="\${1#--token=}" ;;
		--address=*) ADDRESS="\${1#--address=}" ;;
		--user=*) AGENT_USER="\${1#--user=}" ;;
		--help | -h)
			echo "Enrolls this server into Homerun at $HOMERUN_URL."
			echo "  --token=<token>     One-time enrollment token from Remote Hosts (required)"
			echo "  --address=<ip>      Address Homerun and other nodes reach this server at (default: the default route's source address)"
			echo "  --user=<name>       Rootless user the agent runs as (default: homerun)"
			exit 0
			;;
		*)
			echo "error: unknown argument: $1 (see --help)" >&2
			exit 1
			;;
	esac
	shift
done

[ -n "$TOKEN" ] || { echo "error: --token is required, generate one from Remote Hosts." >&2; exit 1; }
[ "$(uname -s)" = "Linux" ] || { echo "error: run this on the Linux server itself." >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "error: run as root (sudo bash -s -- ...)." >&2; exit 1; }

case "$(uname -m)" in
	x86_64 | amd64) ARCH="amd64" ;;
	aarch64 | arm64) ARCH="arm64" ;;
	*) echo "error: unsupported architecture $(uname -m)." >&2; exit 1 ;;
esac

if [ -z "$ADDRESS" ]; then
	ADDRESS="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
fi
[ -n "$ADDRESS" ] || { echo "error: couldn't work out this server's address, pass --address=<ip>." >&2; exit 1; }

field() {
	printf '%s' "$1" | sed -n "s/.*\\"$2\\":\\"\\([^\\"]*\\)\\".*/\\1/p"
}

post() {
	local response status
	response="$(curl -sS -X POST -H 'content-type: application/json' -d "$1" -w '\\n%{http_code}' "$HOMERUN_URL/api/v1/nodes/enroll")"
	status="$(printf '%s' "$response" | tail -n 1)"
	BODY="$(printf '%s' "$response" | sed '$d')"
	if [ "$status" -ge 400 ]; then
		echo "error: Homerun refused the enrollment ($status): $(field "$BODY" error)" >&2
		exit 1
	fi
}

HOSTNAME_VALUE="$(hostname)"
post "{\\"token\\":\\"$TOKEN\\",\\"hostname\\":\\"$HOSTNAME_VALUE\\",\\"plan\\":true}"
BUILD_SERVER="$(printf '%s' "$BODY" | grep -q '"buildServer":true' && echo yes || echo no)"
SWARM_NODE="$(printf '%s' "$BODY" | grep -q '"swarmNode":true' && echo yes || echo no)"
echo "==> Enrolling $HOSTNAME_VALUE ($ADDRESS): build server=$BUILD_SERVER, swarm node=$SWARM_NODE"

echo "==> Installing Docker Engine (skipped if already present)"
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

AGENT_JSON=""
if [ "$BUILD_SERVER" = "yes" ]; then
	echo "==> Installing the Homerun worker in agent mode ($VERSION)"
	if [ "$VERSION" = "latest" ]; then
		INSTALLER_URL="https://github.com/orochibraru/homerun/releases/latest/download/homerun-installer-$ARCH.gz"
	else
		INSTALLER_URL="https://github.com/orochibraru/homerun/releases/download/$VERSION/homerun-installer-$ARCH.gz"
	fi
	INSTALLER_BINARY="$(mktemp)"
	trap 'rm -f "$INSTALLER_BINARY"' EXIT
	curl -fsSL "$INSTALLER_URL" | gunzip -c > "$INSTALLER_BINARY"
	chmod +x "$INSTALLER_BINARY"
	"$INSTALLER_BINARY" --mode=agent --yes "--version=$VERSION" "--user=$AGENT_USER" "--port=$AGENT_PORT"
	TOKEN_FILE="$(getent passwd "$AGENT_USER" | cut -d: -f6)/.homerun-worker/token"
	for _ in $(seq 1 30); do
		[ -s "$TOKEN_FILE" ] && break
		sleep 1
	done
	[ -s "$TOKEN_FILE" ] || { echo "error: the agent never wrote its token to $TOKEN_FILE." >&2; exit 1; }
	AGENT_JSON=",\\"agentUrl\\":\\"http://$ADDRESS:$AGENT_PORT\\",\\"agentToken\\":\\"$(tr -d '[:space:]' < "$TOKEN_FILE")\\""
fi

echo "==> Registering with Homerun"
post "{\\"token\\":\\"$TOKEN\\",\\"hostname\\":\\"$HOSTNAME_VALUE\\"$AGENT_JSON}"

if [ "$SWARM_NODE" = "yes" ]; then
	JOIN_TOKEN="$(field "$BODY" token)"
	MANAGER="$(field "$BODY" managerAddress)"
	echo "==> Joining the swarm at $MANAGER"
	if [ "$(docker info --format '{{.Swarm.LocalNodeState}}')" = "active" ]; then
		echo "Already part of a swarm, skipping. Run 'docker swarm leave' first to join this one."
	else
		docker swarm join --token "$JOIN_TOKEN" --advertise-addr "$ADDRESS" "$MANAGER"
	fi
fi

echo ""
echo "==> Done. $HOSTNAME_VALUE shows up under Remote Hosts in Homerun."
`;
}
