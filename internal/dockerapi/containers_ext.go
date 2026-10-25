package dockerapi

import (
	"context"
	"errors"
	"io"
	"strconv"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

// ContainerInspect is the part of `docker inspect` a deploy reads.
type ContainerInspect struct {
	ID           string `json:"Id"`
	RestartCount int    `json:"RestartCount"`
	State        struct {
		ExitCode int `json:"ExitCode"`
		Health   *struct {
			Log []struct {
				Output string `json:"Output"`
			} `json:"Log"`
			Status string `json:"Status"`
		} `json:"Health"`
		Running bool   `json:"Running"`
		Status  string `json:"Status"`
	} `json:"State"`
}

// ContainerSummary is one row of the container list.
type ContainerSummary struct {
	ID    string `json:"Id"`
	State string `json:"State"`
}

// CreateContainerFrom creates a container from a typed create request, named
// name unless it's empty, and returns its id.
func (c *Client) CreateContainerFrom(ctx context.Context, name string, request container.CreateRequest) (string, error) {
	config := request.Config
	if config == nil {
		config = &container.Config{}
	}
	created, err := control(ctx, ControlTimeout, "create container "+name, "", func(ctx context.Context) (client.ContainerCreateResult, error) {
		return c.api.ContainerCreate(ctx, client.ContainerCreateOptions{
			Config:           config,
			HostConfig:       request.HostConfig,
			Name:             name,
			NetworkingConfig: request.NetworkingConfig,
		})
	})
	return created.ID, err
}

// inspect is the daemon's full typed inspect of a container.
func (c *Client) inspect(ctx context.Context, id string) (client.ContainerInspectResult, error) {
	return control(ctx, ControlTimeout, "inspect "+shortID(id), id, func(ctx context.Context) (client.ContainerInspectResult, error) {
		return c.api.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	})
}

// InspectContainer inspects a container, returning ErrNotFound when it's gone.
func (c *Client) InspectContainer(ctx context.Context, id string) (*ContainerInspect, error) {
	result, err := c.inspect(ctx, id)
	if err != nil {
		return nil, err
	}
	full := result.Container
	inspected := &ContainerInspect{ID: full.ID, RestartCount: full.RestartCount}
	if state := full.State; state != nil {
		inspected.State.ExitCode = state.ExitCode
		inspected.State.Running = state.Running
		inspected.State.Status = string(state.Status)
		if health := state.Health; health != nil {
			inspected.State.Health = &struct {
				Log []struct {
					Output string `json:"Output"`
				} `json:"Log"`
				Status string `json:"Status"`
			}{Status: string(health.Status)}
			for _, entry := range health.Log {
				if entry == nil {
					continue
				}
				inspected.State.Health.Log = append(inspected.State.Health.Log, struct {
					Output string `json:"Output"`
				}{Output: entry.Output})
			}
		}
	}
	return inspected, nil
}

// labelFilter is a list filter on one "key=value" label, or none for "".
func labelFilter(label string) client.Filters {
	filters := client.Filters{}
	if label != "" {
		filters.Add("label", label)
	}
	return filters
}

// ListContainersByLabel lists every container, running or not, carrying label
// (a "key=value" filter).
func (c *Client) ListContainersByLabel(ctx context.Context, label string) ([]ContainerSummary, error) {
	listed, err := c.listContainers(ctx, true, label)
	if err != nil {
		return nil, err
	}
	containers := make([]ContainerSummary, 0, len(listed))
	for _, entry := range listed {
		containers = append(containers, ContainerSummary{ID: entry.ID, State: string(entry.State)})
	}
	return containers, nil
}

// listContainers is the daemon's typed container list.
func (c *Client) listContainers(ctx context.Context, all bool, label string) ([]container.Summary, error) {
	listed, err := control(ctx, ControlTimeout, "list containers", "", func(ctx context.Context) (client.ContainerListResult, error) {
		return c.api.ContainerList(ctx, client.ContainerListOptions{All: all, Filters: labelFilter(label)})
	})
	return listed.Items, err
}

// ContainerLogsTail is the last tail lines of a TTY container's output, which
// the daemon returns unframed.
func (c *Client) ContainerLogsTail(ctx context.Context, id string, tail int) (string, error) {
	return control(ctx, ControlTimeout, "logs "+shortID(id), id, func(ctx context.Context) (string, error) {
		logs, err := c.api.ContainerLogs(ctx, id, client.ContainerLogsOptions{
			ShowStderr: true,
			ShowStdout: true,
			Tail:       strconv.Itoa(tail),
		})
		if err != nil {
			return "", err
		}
		defer func() { _ = logs.Close() }()
		raw, err := io.ReadAll(logs)
		return string(raw), err
	})
}

// AttachContainer attaches to a created container's stdout and stderr before
// it starts, so none of its output is missed. The stream is multiplexed for a
// non-TTY container (see DemuxSplit). The caller closes it.
func (c *Client) AttachContainer(ctx context.Context, id string) (io.ReadCloser, error) {
	return streaming(ctx, "attach "+shortID(id), id, c.containerRunning(id), func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		attached, err := c.attach(ctx, id, false)
		if err != nil {
			return nil, err
		}
		return attached, nil
	})
}

// CreateContainerOn creates a container like CreateContainer, attached to
// network (the HostConfig NetworkMode) when it isn't empty.
func (c *Client) CreateContainerOn(ctx context.Context, config ContainerConfig, network string) (string, error) {
	return c.CreateContainerFrom(ctx, "", container.CreateRequest{
		Config: &container.Config{
			Cmd:        config.Cmd,
			Entrypoint: config.Entrypoint,
			Env:        config.Env,
			Image:      config.Image,
			Labels:     config.Labels,
		},
		HostConfig: &container.HostConfig{
			Binds:       config.Binds,
			NetworkMode: container.NetworkMode(network),
		},
	})
}

// MountSource is the host-side source of the mount container has at
// destination, or "" when the container doesn't exist or has no such mount.
func (c *Client) MountSource(ctx context.Context, name, destination string) (string, error) {
	result, err := c.inspect(ctx, name)
	if errors.Is(err, ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	for _, mount := range result.Container.Mounts {
		if mount.Destination == destination {
			return mount.Source, nil
		}
	}
	return "", nil
}
