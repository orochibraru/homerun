package dockerapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
)

// PruneReport is what one of the daemon's prune endpoints reclaimed.
type PruneReport struct {
	Deleted        int
	SpaceReclaimed int64
}

// DiskUsageImage is one image of a `docker system df` answer.
type DiskUsageImage struct {
	Containers int      `json:"Containers"`
	ID         string   `json:"Id"`
	RepoTags   []string `json:"RepoTags"`
	Size       int64    `json:"Size"`
}

// DiskUsageVolume is one volume of a `docker system df` answer.
type DiskUsageVolume struct {
	Name      string `json:"Name"`
	UsageData *struct {
		RefCount int   `json:"RefCount"`
		Size     int64 `json:"Size"`
	} `json:"UsageData"`
}

// DiskUsage is the images and volumes halves of `docker system df`.
type DiskUsage struct {
	Images  []DiskUsageImage  `json:"Images"`
	Volumes []DiskUsageVolume `json:"Volumes"`
}

// Network is one entry of the daemon's network list.
type Network struct {
	Containers map[string]json.RawMessage `json:"Containers"`
	ID         string                     `json:"Id"`
	Name       string                     `json:"Name"`
}

// ExecResult is a finished `docker exec`'s exit code and its output streams.
type ExecResult struct {
	ExitCode int
	Stderr   string
	Stdout   string
}

// pruneDecode sends one call and decodes its JSON answer into target.
func (c *Client) pruneDecode(ctx context.Context, method, path string, query url.Values, body, target any) error {
	response, err := c.request(ctx, method, path, query, body, nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return json.NewDecoder(response.Body).Decode(target)
}

// prune POSTs one prune endpoint and summarizes its answer into a PruneReport.
func (c *Client) prune(ctx context.Context, path, deletedKey string, query url.Values) (PruneReport, error) {
	var raw map[string]json.RawMessage
	if err := c.pruneDecode(ctx, http.MethodPost, path, query, nil, &raw); err != nil {
		return PruneReport{}, err
	}
	var report PruneReport
	var deleted []json.RawMessage
	if value, ok := raw[deletedKey]; ok {
		_ = json.Unmarshal(value, &deleted)
	}
	if value, ok := raw["SpaceReclaimed"]; ok {
		_ = json.Unmarshal(value, &report.SpaceReclaimed)
	}
	report.Deleted = len(deleted)
	return report, nil
}

// pruneFilters is a prune endpoint's ?filters= query for one key=value filter.
func pruneFilters(key, value string) url.Values {
	encoded, _ := json.Marshal(map[string][]string{key: {value}})
	return url.Values{"filters": {string(encoded)}}
}

// PruneContainers removes every stopped container (`docker container prune`).
func (c *Client) PruneContainers(ctx context.Context) (PruneReport, error) {
	return c.prune(ctx, "/containers/prune", "ContainersDeleted", nil)
}

// PruneImages removes dangling images, or with all every image no container
// uses (`docker image prune [-a]`).
func (c *Client) PruneImages(ctx context.Context, all bool) (PruneReport, error) {
	var query url.Values
	if all {
		query = pruneFilters("dangling", "false")
	}
	return c.prune(ctx, "/images/prune", "ImagesDeleted", query)
}

// PruneNetworks removes every unused network (`docker network prune`).
func (c *Client) PruneNetworks(ctx context.Context) (PruneReport, error) {
	return c.prune(ctx, "/networks/prune", "NetworksDeleted", nil)
}

// PruneBuildCache clears the build cache (`docker builder prune`). The daemon
// only reports reclaimed space, so Deleted stays 0.
func (c *Client) PruneBuildCache(ctx context.Context) (PruneReport, error) {
	report, err := c.prune(ctx, "/build/prune", "", nil)
	report.Deleted = 0
	return report, err
}

// PruneVolumes removes every unused volume, named ones included
// (`docker volume prune --all`).
func (c *Client) PruneVolumes(ctx context.Context) (PruneReport, error) {
	return c.prune(ctx, "/volumes/prune", "VolumesDeleted", pruneFilters("all", "true"))
}

// SystemDiskUsage is `docker system df`'s images and volumes.
func (c *Client) SystemDiskUsage(ctx context.Context) (DiskUsage, error) {
	var usage DiskUsage
	err := c.pruneDecode(ctx, http.MethodGet, "/system/df", nil, nil, &usage)
	return usage, err
}

// RemoveUnusedImage removes one image without force, so an image a container
// or a child image still needs is refused by the daemon.
func (c *Client) RemoveUnusedImage(ctx context.Context, id string) error {
	return c.Call(ctx, http.MethodDelete, "/images/"+id, url.Values{"force": {"0"}}, nil)
}

// NetworkList lists every network on the daemon.
func (c *Client) NetworkList(ctx context.Context) ([]Network, error) {
	var networks []Network
	err := c.pruneDecode(ctx, http.MethodGet, "/networks", nil, nil, &networks)
	return networks, err
}

// NetworkRemove removes one network.
func (c *Client) NetworkRemove(ctx context.Context, id string) error {
	return c.Call(ctx, http.MethodDelete, "/networks/"+id, nil, nil)
}

// ContainerIsRunning reports whether the named container exists and runs.
func (c *Client) ContainerIsRunning(ctx context.Context, name string) (bool, error) {
	var inspected struct {
		State struct {
			Running bool `json:"Running"`
		} `json:"State"`
	}
	err := c.pruneDecode(ctx, http.MethodGet, "/containers/"+name+"/json", nil, nil, &inspected)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return inspected.State.Running, err
}

// ContainerRestart restarts the named container.
func (c *Client) ContainerRestart(ctx context.Context, name string) error {
	return c.Call(ctx, http.MethodPost, "/containers/"+name+"/restart", nil, nil)
}

// ContainerExec runs cmd inside the named running container and waits for it,
// returning its exit code and its stdout and stderr kept apart.
func (c *Client) ContainerExec(ctx context.Context, name string, cmd []string) (ExecResult, error) {
	var created struct {
		ID string `json:"Id"`
	}
	if err := c.pruneDecode(ctx, http.MethodPost, "/containers/"+name+"/exec", nil,
		map[string]any{"AttachStderr": true, "AttachStdout": true, "Cmd": cmd}, &created); err != nil {
		return ExecResult{}, err
	}
	response, err := c.request(ctx, http.MethodPost, "/exec/"+created.ID+"/start", nil,
		map[string]any{"Detach": false, "Tty": false}, nil)
	if err != nil {
		return ExecResult{}, err
	}
	var stdout, stderr bytes.Buffer
	err = DemuxSplit(response.Body, &stdout, &stderr)
	_ = response.Body.Close()
	if err != nil {
		return ExecResult{}, err
	}
	var inspected struct {
		ExitCode int `json:"ExitCode"`
	}
	if err := c.pruneDecode(ctx, http.MethodGet, "/exec/"+created.ID+"/json", nil, nil, &inspected); err != nil {
		return ExecResult{}, err
	}
	return ExecResult{ExitCode: inspected.ExitCode, Stderr: stderr.String(), Stdout: stdout.String()}, nil
}
