package installer

import (
	"errors"
	"fmt"
	"strings"
)

// SwarmNodeState is where this host sits in a swarm, if anywhere.
type SwarmNodeState string

const (
	// SwarmInactive is a host that isn't in a swarm.
	SwarmInactive SwarmNodeState = "inactive"
	// SwarmManager is an active node with control available.
	SwarmManager SwarmNodeState = "manager"
	// SwarmWorker is an active node without control.
	SwarmWorker SwarmNodeState = "worker"
)

// ParseSwarmNodeState reads `docker info --format '{{.Swarm.LocalNodeState}}
// {{.Swarm.ControlAvailable}}'` output: a manager is active with control
// available, a worker is active without it, anything else (inactive, pending,
// an empty dry-run) isn't in a swarm yet.
func ParseSwarmNodeState(infoOutput string) SwarmNodeState {
	fields := strings.Fields(strings.TrimSpace(infoOutput))
	if len(fields) == 0 || fields[0] != "active" {
		return SwarmInactive
	}
	if len(fields) > 1 && fields[1] == "true" {
		return SwarmManager
	}
	return SwarmWorker
}

// SwarmInitCommand is the `docker swarm init` argv, advertising
// advertiseAddress when there is one.
func SwarmInitCommand(advertiseAddress string) []string {
	if advertiseAddress == "" {
		return []string{"docker", "swarm", "init"}
	}
	return []string{"docker", "swarm", "init", "--advertise-addr", advertiseAddress}
}

// EnsureSwarmManager makes the system daemon a swarm manager, skipping a host
// that already is one. The address is passed explicitly because `docker swarm
// init` refuses to guess on a host with several interfaces ("could not choose
// an IP address to advertise").
//
// advertiseAddress is --advertise-addr=, or the detected default-route address.
// Fails when the host is a worker in another swarm, or when init fails.
func EnsureSwarmManager(run Runner, advertiseAddress string) error {
	info, err := run.Run(
		[]string{"docker", "info", "--format", "{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}"},
		systemDocker,
	)
	if err != nil {
		return err
	}
	switch ParseSwarmNodeState(info.Stdout) {
	case SwarmManager:
		fmt.Println("This host is already a swarm manager, skipping init.")
		return nil
	case SwarmWorker:
		return errors.New(
			"This host is a worker in another swarm : Homerun needs to run on a manager. Run `docker swarm leave` first, or install on the manager.",
		)
	}
	if _, err := run.Run(SwarmInitCommand(advertiseAddress), systemDocker); err != nil {
		advertising := ""
		if advertiseAddress != "" {
			advertising = " advertising " + advertiseAddress
		}
		return fmt.Errorf(
			"docker swarm init failed%s : re-run with --advertise-addr=<this host's IP>. %w",
			advertising, err,
		)
	}
	return nil
}

// EnsureOverlayNetwork creates the attachable overlay network swarm services
// join, named and shaped the way the app's own ensureSwarmNetwork makes it
// (<networkName>-swarm, overlay, attachable) so Traefik's compose container can
// join it too. Idempotent.
//
// Fails when a network of that name exists but isn't an attachable overlay.
func EnsureOverlayNetwork(run Runner) error {
	inspected, err := run.Run(
		[]string{"docker", "network", "inspect", "--format", "{{.Driver}} {{.Attachable}}", SwarmNetwork},
		systemDocker,
	)
	if err == nil {
		shape := strings.TrimSpace(inspected.Stdout)
		if shape != "" && shape != "overlay true" {
			return fmt.Errorf(
				"A %q network already exists as %q : remove it (docker network rm %s) so it can be recreated as an attachable overlay.",
				SwarmNetwork, shape, SwarmNetwork,
			)
		}
		fmt.Printf("%s already exists, skipping.\n", SwarmNetwork)
		return nil
	}
	_, err = run.Run(
		[]string{"docker", "network", "create", "--driver", "overlay", "--attachable", SwarmNetwork},
		systemDocker,
	)
	return err
}
