package dockerapi

import (
	"context"

	"github.com/moby/moby/client"
)

// StopContainer stops a container. One already stopped isn't an error: the
// daemon answers 304, which the SDK takes as success.
func (c *Client) StopContainer(ctx context.Context, id string) error {
	return discard(control(ctx, 2*ControlTimeout, "stop "+shortID(id), id, func(ctx context.Context) (client.ContainerStopResult, error) {
		return c.api.ContainerStop(ctx, id, client.ContainerStopOptions{})
	}))
}

// EnsureContainerStarted starts a container. One already running isn't an error.
func (c *Client) EnsureContainerStarted(ctx context.Context, id string) error {
	return c.StartContainer(ctx, id)
}
