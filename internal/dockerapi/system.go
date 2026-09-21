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

// Info is the part of `docker info` this app reads: the swarm's state (is this
// daemon a manager, what node is it) and the security options, which is where
// a rootless daemon announces itself.
type Info struct {
	SecurityOptions []string `json:"SecurityOptions"`
	ServerVersion   string   `json:"ServerVersion"`
	Swarm           struct {
		ControlAvailable bool   `json:"ControlAvailable"`
		LocalNodeState   string `json:"LocalNodeState"`
		NodeID           string `json:"NodeID"`
	} `json:"Swarm"`
}

// Volume is one entry of the daemon's volume list.
type Volume struct {
	CreatedAt  string            `json:"CreatedAt"`
	Labels     map[string]string `json:"Labels"`
	Mountpoint string            `json:"Mountpoint"`
	Name       string            `json:"Name"`
	UsageData  *struct {
		RefCount int   `json:"RefCount"`
		Size     int64 `json:"Size"`
	} `json:"UsageData"`
}

// ContainerListEntry is one row of the container list, with everything the
// dashboard's infra and Traefik lookups read off it. HostConfig and
// NetworkSettings are carried because the Pangolin tunnel target is decided
// from them: whether Traefik and the newt container share a network, and
// whether newt is on host networking.
type ContainerListEntry struct {
	Created    int64 `json:"Created"`
	HostConfig *struct {
		NetworkMode string `json:"NetworkMode"`
	} `json:"HostConfig"`
	ID              string            `json:"Id"`
	Image           string            `json:"Image"`
	Labels          map[string]string `json:"Labels"`
	Names           []string          `json:"Names"`
	NetworkSettings *struct {
		Networks map[string]json.RawMessage `json:"Networks"`
	} `json:"NetworkSettings"`
	State  string `json:"State"`
	Status string `json:"Status"`
}

// SystemInfo reads `docker info`.
func (c *Client) SystemInfo(ctx context.Context) (*Info, error) {
	var info Info
	if err := c.decode(ctx, http.MethodGet, "/info", nil, nil, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// ListVolumes lists every volume on the daemon.
func (c *Client) ListVolumes(ctx context.Context) ([]Volume, error) {
	var listed struct {
		Volumes []Volume `json:"Volumes"`
	}
	err := c.decode(ctx, http.MethodGet, "/volumes", nil, nil, &listed)
	return listed.Volumes, err
}

// ListContainers lists containers, running ones only unless all is set, and
// filtered to one "key=value" label when label isn't empty.
func (c *Client) ListContainers(ctx context.Context, all bool, label string) ([]ContainerListEntry, error) {
	query := url.Values{}
	if all {
		query.Set("all", "1")
	}
	if label != "" {
		filters, err := json.Marshal(map[string][]string{"label": {label}})
		if err != nil {
			return nil, err
		}
		query.Set("filters", string(filters))
	}
	var containers []ContainerListEntry
	err := c.decode(ctx, http.MethodGet, "/containers/json", query, nil, &containers)
	return containers, err
}

// InspectRaw inspects a container and hands back the daemon's answer whole,
// for the callers that rebuild a container from its own config (recreating
// Traefik with a changed flag) and would lose fields to a narrower struct.
func (c *Client) InspectRaw(ctx context.Context, id string) (map[string]any, error) {
	var inspected map[string]any
	if err := c.decode(ctx, http.MethodGet, "/containers/"+id+"/json", nil, nil, &inspected); err != nil {
		return nil, err
	}
	return inspected, nil
}

// InspectImageRaw inspects an image and hands back the daemon's answer whole.
func (c *Client) InspectImageRaw(ctx context.Context, ref string) (map[string]any, error) {
	var inspected map[string]any
	if err := c.decode(ctx, http.MethodGet, "/images/"+ref+"/json", nil, nil, &inspected); err != nil {
		return nil, err
	}
	return inspected, nil
}

// ContainerLogsStream opens a container's logs, following them when follow is
// set and starting from the last tail lines when tail is positive. The caller
// closes the stream, which is what stops the daemon writing to it.
func (c *Client) ContainerLogsStream(ctx context.Context, id string, tail int, follow bool) (io.ReadCloser, error) {
	query := url.Values{"stderr": {"1"}, "stdout": {"1"}}
	if follow {
		query.Set("follow", "1")
	}
	if tail > 0 {
		query.Set("tail", strconv.Itoa(tail))
	}
	response, err := c.request(ctx, http.MethodGet, "/containers/"+id+"/logs", query, nil, nil)
	if err != nil {
		return nil, err
	}
	return response.Body, nil
}

// RemoveContainerOpts removes a container, forcing a running one to stop first
// only when force is set, so a caller that means "remove it if it's idle"
// isn't silently killing a live workload. A container already gone isn't an
// error: the caller asked for it to not be there.
func (c *Client) RemoveContainerOpts(ctx context.Context, id string, force bool) error {
	value := "0"
	if force {
		value = "1"
	}
	err := c.Call(ctx, http.MethodDelete, "/containers/"+id, url.Values{"force": {value}}, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// RemoveImage removes one image, forcing it when force is set.
func (c *Client) RemoveImage(ctx context.Context, id string, force bool) error {
	value := "0"
	if force {
		value = "1"
	}
	return c.Call(ctx, http.MethodDelete, "/images/"+id, url.Values{"force": {value}}, nil)
}

// DisconnectNetwork detaches a container from a network.
func (c *Client) DisconnectNetwork(ctx context.Context, network, containerID string, force bool) error {
	return c.Call(ctx, http.MethodPost, "/networks/"+network+"/disconnect", nil,
		map[string]any{"Container": containerID, "Force": force})
}
