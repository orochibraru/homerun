package dockerapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
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

// decode sends one call and decodes its JSON answer into target.
func (c *Client) decode(ctx context.Context, method, path string, query url.Values, body, target any) error {
	response, err := c.request(ctx, method, path, query, body, nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return json.NewDecoder(response.Body).Decode(target)
}

// CreateContainerFrom creates a container from a raw Engine API create body,
// named name unless it's empty, and returns its id.
func (c *Client) CreateContainerFrom(ctx context.Context, name string, body map[string]any) (string, error) {
	var query url.Values
	if name != "" {
		query = url.Values{"name": {name}}
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := c.decode(ctx, http.MethodPost, "/containers/create", query, body, &created); err != nil {
		return "", err
	}
	return created.ID, nil
}

// InspectContainer inspects a container, returning ErrNotFound when it's gone.
func (c *Client) InspectContainer(ctx context.Context, id string) (*ContainerInspect, error) {
	var inspected ContainerInspect
	if err := c.decode(ctx, http.MethodGet, "/containers/"+id+"/json", nil, nil, &inspected); err != nil {
		return nil, err
	}
	return &inspected, nil
}

// ListContainersByLabel lists every container, running or not, carrying label
// (a "key=value" filter).
func (c *Client) ListContainersByLabel(ctx context.Context, label string) ([]ContainerSummary, error) {
	filters, err := json.Marshal(map[string][]string{"label": {label}})
	if err != nil {
		return nil, err
	}
	var containers []ContainerSummary
	err = c.decode(ctx, http.MethodGet, "/containers/json",
		url.Values{"all": {"1"}, "filters": {string(filters)}}, nil, &containers)
	return containers, err
}

// PathExists reports whether path exists inside a container, running or not.
func (c *Client) PathExists(ctx context.Context, id, path string) (bool, error) {
	err := c.Call(ctx, http.MethodHead, "/containers/"+id+"/archive", url.Values{"path": {path}}, nil)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// ContainerLogsTail is the last tail lines of a TTY container's output, which
// the daemon returns unframed.
func (c *Client) ContainerLogsTail(ctx context.Context, id string, tail int) (string, error) {
	response, err := c.request(ctx, http.MethodGet, "/containers/"+id+"/logs",
		url.Values{"stdout": {"1"}, "stderr": {"1"}, "tail": {strconv.Itoa(tail)}}, nil, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(response.Body)
	return string(raw), err
}

// AttachContainer attaches to a created container's stdout and stderr before
// it starts, so none of its output is missed. The stream is multiplexed for a
// non-TTY container (see DemuxSplit). The caller closes it.
func (c *Client) AttachContainer(ctx context.Context, id string) (io.ReadCloser, error) {
	response, err := c.request(ctx, http.MethodPost, "/containers/"+id+"/attach",
		url.Values{"stream": {"1"}, "stdout": {"1"}, "stderr": {"1"}}, nil, nil)
	if err != nil {
		return nil, err
	}
	return response.Body, nil
}

// CreateContainerOn creates a container like CreateContainer, attached to
// network (the HostConfig NetworkMode) when it isn't empty.
func (c *Client) CreateContainerOn(ctx context.Context, config ContainerConfig, network string) (string, error) {
	hostConfig := map[string]any{"Binds": config.Binds}
	if network != "" {
		hostConfig["NetworkMode"] = network
	}
	body := map[string]any{
		"Cmd":        config.Cmd,
		"Entrypoint": config.Entrypoint,
		"Env":        config.Env,
		"HostConfig": hostConfig,
		"Image":      config.Image,
		"Labels":     config.Labels,
		"Tty":        false,
	}
	return c.CreateContainerFrom(ctx, "", body)
}

// MountSource is the host-side source of the mount container has at
// destination, or "" when the container doesn't exist or has no such mount.
func (c *Client) MountSource(ctx context.Context, container, destination string) (string, error) {
	response, err := c.request(ctx, http.MethodGet, "/containers/"+container+"/json", nil, nil, nil)
	if errors.Is(err, ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	defer func() { _ = response.Body.Close() }()
	var inspected struct {
		Mounts []struct {
			Destination string `json:"Destination"`
			Source      string `json:"Source"`
		} `json:"Mounts"`
	}
	if err := json.NewDecoder(response.Body).Decode(&inspected); err != nil {
		return "", err
	}
	for _, mount := range inspected.Mounts {
		if mount.Destination == destination {
			return mount.Source, nil
		}
	}
	return "", nil
}
