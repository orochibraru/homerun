package dockerapi

import (
	"context"
	"strconv"

	"github.com/moby/moby/api/types/network"
)

// PublishedPort is the host port the daemon bound for a container's
// containerPort ("8080/tcp"), 0 when it isn't published or the container isn't
// running.
func (c *Client) PublishedPort(ctx context.Context, id, containerPort string) (int, error) {
	port, err := network.ParsePort(containerPort)
	if err != nil {
		return 0, err
	}
	result, err := c.inspect(ctx, id)
	if err != nil {
		return 0, err
	}
	settings := result.Container.NetworkSettings
	if settings == nil {
		return 0, nil
	}
	for _, binding := range settings.Ports[port] {
		published, err := strconv.Atoi(binding.HostPort)
		if err == nil && published > 0 {
			return published, nil
		}
	}
	return 0, nil
}
