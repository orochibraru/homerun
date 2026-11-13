package dockerapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/zedensix/homerun/internal/hoststats"
)

// HostProcesses reads every process on the host from a helper container in the
// host's PID namespace: the worker runs in a container of its own, whose /proc
// only holds its own processes. The helper's own processes count as a
// container's, like every other.
func (c *Client) HostProcesses(ctx context.Context, image string) ([]hoststats.Process, error) {
	result, err := c.RunHelper(ctx, HelperConfig{
		Cmd:             []string{"sh", "-c", hoststats.ProcessScript},
		Image:           image,
		NetworkDisabled: true,
		PidMode:         "host",
	})
	if err != nil {
		return nil, err
	}
	if result.ExitCode != 0 {
		return nil, fmt.Errorf("reading the host's processes exited %d: %s", result.ExitCode, strings.TrimSpace(result.Stderr))
	}
	return hoststats.ParseProcesses(result.Stdout), nil
}
