package dockerapi

import (
	"context"
	"strings"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

// NetworkSpec is a network create request: the SDK's typed options plus the
// name, decoding straight from an Engine API create body.
type NetworkSpec struct {
	client.NetworkCreateOptions
	Name string
}

// EnsureNetwork creates a network, reporting whether it was created: one that
// already exists (a 409, or an overlay's "already exists" message) isn't an
// error.
func (c *Client) EnsureNetwork(ctx context.Context, spec NetworkSpec) (bool, error) {
	err := discard(control(ctx, ControlTimeout, "create network "+spec.Name, "", func(ctx context.Context) (client.NetworkCreateResult, error) {
		return c.api.NetworkCreate(ctx, spec.Name, spec.NetworkCreateOptions)
	}))
	if err != nil && (cerrdefs.IsConflict(err) || strings.Contains(strings.ToLower(err.Error()), "already exists")) {
		return false, nil
	}
	return err == nil, err
}

// ConnectNetwork attaches a container to a network under aliases.
func (c *Client) ConnectNetwork(ctx context.Context, name, containerID string, aliases []string) error {
	return discard(control(ctx, ControlTimeout, "connect "+shortID(containerID)+" to "+name, containerID, func(ctx context.Context) (client.NetworkConnectResult, error) {
		return c.api.NetworkConnect(ctx, name, client.NetworkConnectOptions{
			Container:      containerID,
			EndpointConfig: &network.EndpointSettings{Aliases: aliases},
		})
	}))
}

// DisconnectNetwork detaches a container from a network.
func (c *Client) DisconnectNetwork(ctx context.Context, name, containerID string, force bool) error {
	return discard(control(ctx, ControlTimeout, "disconnect "+shortID(containerID)+" from "+name, containerID, func(ctx context.Context) (client.NetworkDisconnectResult, error) {
		return c.api.NetworkDisconnect(ctx, name, client.NetworkDisconnectOptions{Container: containerID, Force: force})
	}))
}

// EnsureOverlayNetwork creates an attachable overlay network, treating one
// that already exists as success. Swarm services can only join an overlay, so
// this is the second network a swarm-mode host needs alongside the shared
// bridge every plain container is on.
func (c *Client) EnsureOverlayNetwork(ctx context.Context, name string, labels map[string]string) error {
	_, err := c.EnsureNetwork(ctx, NetworkSpec{
		Name:                 name,
		NetworkCreateOptions: client.NetworkCreateOptions{Attachable: true, Driver: "overlay", Labels: labels},
	})
	return err
}

// NetworkContainers is how many containers are attached to a network. The
// network list never says (the Engine dropped it from list entries in API
// 1.28), so this inspects the one network.
func (c *Client) NetworkContainers(ctx context.Context, id string) (int, error) {
	inspected, err := control(ctx, ControlTimeout, "inspect network "+id, "", func(ctx context.Context) (client.NetworkInspectResult, error) {
		return c.api.NetworkInspect(ctx, id, client.NetworkInspectOptions{})
	})
	return len(inspected.Network.Containers), err
}
