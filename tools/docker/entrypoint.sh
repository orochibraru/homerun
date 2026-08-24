#!/bin/sh
# Runs as root (the image's final USER is intentionally unset, see
# Dockerfile), fixes up Docker-socket group access for the unprivileged
# `bun` user, then execs the real command as `bun`, never as root.
#
# Real, tested problem this works around: `/var/run/docker.sock` is bind-
# mounted from the host (tools/compose/app.compose.yaml), where it's owned
# by root and a docker/dockerd group whose GID is whatever the host assigned
# it, not something knowable at image build time. The app's own image builds
# a `bun` user with a fixed GID baked in, which essentially never matches, so
# a plain `USER bun` in the Dockerfile hits `EACCES` connecting to the socket
# unconditionally, verified live (Bun.connect() against a real socket with a
# foreign group GID: EACCES without this fix, connects fine with it). Every
# service deploy and the System Logs page both need the socket, so this
# isn't an edge case, it breaks the app's core function.
#
# Fixed the same way most Docker-socket-consuming images do it (portainer,
# docker-gen, etc.): detect the socket's actual GID at container start,
# create/reuse a matching group, add `bun` to it, then su-exec into `bun`
# for the real process. su-exec replaces this shell via execve, so the
# actual long-running process is genuinely `bun`, not root, same end
# security posture as a plain `USER bun` would have had, if it had worked.
set -e

SOCKET="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"

if [ -S "$SOCKET" ]; then
	SOCKET_GID="$(stat -c '%g' "$SOCKET")"
	SOCKET_GROUP="$(getent group "$SOCKET_GID" | cut -d: -f1)"

	if [ -z "$SOCKET_GROUP" ]; then
		SOCKET_GROUP=dockersock
		addgroup -g "$SOCKET_GID" "$SOCKET_GROUP"
	fi

	if ! id -nG bun | tr ' ' '\n' | grep -qx "$SOCKET_GROUP"; then
		addgroup bun "$SOCKET_GROUP"
	fi
fi

exec su-exec bun "$@"
