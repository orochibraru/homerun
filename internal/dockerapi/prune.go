package dockerapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	"github.com/moby/moby/client"
)

// PruneReport is what one of the daemon's prune endpoints reclaimed.
type PruneReport struct {
	Deleted        int
	SpaceReclaimed int64
}

// DiskUsageImage is one image of a `docker system df` answer.
type DiskUsageImage struct {
	Containers  int      `json:"Containers"`
	Created     int64    `json:"Created"`
	ID          string   `json:"Id"`
	RepoDigests []string `json:"RepoDigests"`
	RepoTags    []string `json:"RepoTags"`
	SharedSize  int64    `json:"SharedSize"`
	Size        int64    `json:"Size"`
}

// DiskUsageVolume is one volume of a `docker system df` answer.
type DiskUsageVolume struct {
	Driver    string       `json:"Driver"`
	Name      string       `json:"Name"`
	UsageData *VolumeUsage `json:"UsageData"`
}

// DiskUsageContainer is one container of a `docker system df` answer.
type DiskUsageContainer struct {
	ID              string             `json:"Id"`
	Image           string             `json:"Image"`
	Names           []string           `json:"Names"`
	NetworkSettings *ContainerNetworks `json:"NetworkSettings"`
	SizeRootFs      int64              `json:"SizeRootFs"`
	SizeRw          int64              `json:"SizeRw"`
	State           string             `json:"State"`
	Status          string             `json:"Status"`
}

// DiskUsageBuildCache is one build cache record of a `docker system df` answer.
type DiskUsageBuildCache struct {
	Description string `json:"Description"`
	ID          string `json:"ID"`
	InUse       bool   `json:"InUse"`
	LastUsedAt  string `json:"LastUsedAt"`
	Shared      bool   `json:"Shared"`
	Size        int64  `json:"Size"`
	Type        string `json:"Type"`
}

// DiskUsage is `docker system df`, whole: the Docker Cleanup page previews
// every category from it.
type DiskUsage struct {
	BuildCache []DiskUsageBuildCache `json:"BuildCache"`
	Containers []DiskUsageContainer  `json:"Containers"`
	Images     []DiskUsageImage      `json:"Images"`
	LayersSize int64                 `json:"LayersSize"`
	Volumes    []DiskUsageVolume     `json:"Volumes"`
}

// Network is one entry of the daemon's network list.
type Network struct {
	Containers map[string]json.RawMessage `json:"Containers"`
	Driver     string                     `json:"Driver"`
	ID         string                     `json:"Id"`
	Name       string                     `json:"Name"`
}

// ExecResult is a finished `docker exec`'s exit code and its output streams.
type ExecResult struct {
	ExitCode int
	Stderr   string
	Stdout   string
}

// PruneContainers removes every stopped container (`docker container prune`).
func (c *Client) PruneContainers(ctx context.Context) (PruneReport, error) {
	result, err := control(ctx, SlowTimeout, "prune containers", "", func(ctx context.Context) (client.ContainerPruneResult, error) {
		return c.api.ContainerPrune(ctx, client.ContainerPruneOptions{})
	})
	return PruneReport{Deleted: len(result.Report.ContainersDeleted), SpaceReclaimed: toInt64(result.Report.SpaceReclaimed)}, err
}

// PruneImages removes dangling images, or with all every image no container
// uses (`docker image prune [-a]`).
func (c *Client) PruneImages(ctx context.Context, all bool) (PruneReport, error) {
	filters := client.Filters{}
	if all {
		filters.Add("dangling", "false")
	}
	result, err := control(ctx, SlowTimeout, "prune images", "", func(ctx context.Context) (client.ImagePruneResult, error) {
		return c.api.ImagePrune(ctx, client.ImagePruneOptions{Filters: filters})
	})
	return PruneReport{Deleted: len(result.Report.ImagesDeleted), SpaceReclaimed: toInt64(result.Report.SpaceReclaimed)}, err
}

// PruneNetworks removes every unused network (`docker network prune`).
func (c *Client) PruneNetworks(ctx context.Context) (PruneReport, error) {
	result, err := control(ctx, SlowTimeout, "prune networks", "", func(ctx context.Context) (client.NetworkPruneResult, error) {
		return c.api.NetworkPrune(ctx, client.NetworkPruneOptions{})
	})
	return PruneReport{Deleted: len(result.Report.NetworksDeleted)}, err
}

// PruneBuildCache clears the build cache (`docker builder prune`). The daemon
// only reports reclaimed space, so Deleted stays 0.
func (c *Client) PruneBuildCache(ctx context.Context) (PruneReport, error) {
	result, err := control(ctx, SlowTimeout, "prune build cache", "", func(ctx context.Context) (client.BuildCachePruneResult, error) {
		return c.api.BuildCachePrune(ctx, client.BuildCachePruneOptions{})
	})
	return PruneReport{SpaceReclaimed: toInt64(result.Report.SpaceReclaimed)}, err
}

// PruneVolumes removes every unused volume, named ones included
// (`docker volume prune --all`).
func (c *Client) PruneVolumes(ctx context.Context) (PruneReport, error) {
	result, err := control(ctx, SlowTimeout, "prune volumes", "", func(ctx context.Context) (client.VolumePruneResult, error) {
		return c.api.VolumePrune(ctx, client.VolumePruneOptions{All: true})
	})
	return PruneReport{Deleted: len(result.Report.VolumesDeleted), SpaceReclaimed: toInt64(result.Report.SpaceReclaimed)}, err
}

// SystemDiskUsage is `docker system df`, every category of it.
func (c *Client) SystemDiskUsage(ctx context.Context) (DiskUsage, error) {
	result, err := control(ctx, SlowTimeout, "system df", "", func(ctx context.Context) (client.DiskUsageResult, error) {
		return c.api.DiskUsage(ctx, client.DiskUsageOptions{BuildCache: true, Containers: true, Images: true, Verbose: true, Volumes: true})
	})
	if err != nil {
		return DiskUsage{}, err
	}
	usage := DiskUsage{
		BuildCache: []DiskUsageBuildCache{},
		Containers: []DiskUsageContainer{},
		Images:     []DiskUsageImage{},
		LayersSize: result.Images.TotalSize,
		Volumes:    []DiskUsageVolume{},
	}
	for _, record := range result.BuildCache.Items {
		entry := DiskUsageBuildCache{
			Description: record.Description,
			ID:          record.ID,
			InUse:       record.InUse,
			Shared:      record.Shared,
			Size:        record.Size,
			Type:        record.Type,
		}
		if record.LastUsedAt != nil {
			entry.LastUsedAt = timestamp(*record.LastUsedAt)
		}
		usage.BuildCache = append(usage.BuildCache, entry)
	}
	for _, entry := range result.Containers.Items {
		usage.Containers = append(usage.Containers, DiskUsageContainer{
			ID:              entry.ID,
			Image:           entry.Image,
			Names:           entry.Names,
			NetworkSettings: containerNetworks(entry),
			SizeRootFs:      entry.SizeRootFs,
			SizeRw:          entry.SizeRw,
			State:           string(entry.State),
			Status:          entry.Status,
		})
	}
	for _, entry := range result.Images.Items {
		usage.Images = append(usage.Images, DiskUsageImage{
			Containers:  int(entry.Containers),
			Created:     entry.Created,
			ID:          entry.ID,
			RepoDigests: entry.RepoDigests,
			RepoTags:    entry.RepoTags,
			SharedSize:  entry.SharedSize,
			Size:        entry.Size,
		})
	}
	for _, entry := range result.Volumes.Items {
		usage.Volumes = append(usage.Volumes, DiskUsageVolume{Driver: entry.Driver, Name: entry.Name, UsageData: volumeUsage(entry.UsageData)})
	}
	return usage, nil
}

// RemoveUnusedImage removes one image without force, so an image a container
// or a child image still needs is refused by the daemon.
func (c *Client) RemoveUnusedImage(ctx context.Context, id string) error {
	return c.RemoveImage(ctx, id, false)
}

// NetworkList lists every network on the daemon.
func (c *Client) NetworkList(ctx context.Context) ([]Network, error) {
	listed, err := control(ctx, ControlTimeout, "list networks", "", func(ctx context.Context) (client.NetworkListResult, error) {
		return c.api.NetworkList(ctx, client.NetworkListOptions{})
	})
	if err != nil {
		return nil, err
	}
	networks := make([]Network, 0, len(listed.Items))
	for _, entry := range listed.Items {
		networks = append(networks, Network{Driver: entry.Driver, ID: entry.ID, Name: entry.Name})
	}
	return networks, nil
}

// NetworkRemove removes one network.
func (c *Client) NetworkRemove(ctx context.Context, id string) error {
	return discard(control(ctx, ControlTimeout, "remove network "+id, "", func(ctx context.Context) (client.NetworkRemoveResult, error) {
		return c.api.NetworkRemove(ctx, id, client.NetworkRemoveOptions{})
	}))
}

// ContainerIsRunning reports whether the named container exists and runs.
func (c *Client) ContainerIsRunning(ctx context.Context, name string) (bool, error) {
	inspected, err := c.InspectContainer(ctx, name)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return inspected.State.Running, nil
}

// ContainerRestart restarts the named container.
func (c *Client) ContainerRestart(ctx context.Context, name string) error {
	return discard(control(ctx, 2*ControlTimeout, "restart "+name, name, func(ctx context.Context) (client.ContainerRestartResult, error) {
		return c.api.ContainerRestart(ctx, name, client.ContainerRestartOptions{})
	}))
}

// ContainerExec runs cmd inside the named running container and waits for it,
// returning its exit code and its stdout and stderr kept apart.
func (c *Client) ContainerExec(ctx context.Context, name string, cmd []string) (ExecResult, error) {
	id, err := c.CreateExec(ctx, name, ExecConfig{Cmd: cmd})
	if err != nil {
		return ExecResult{}, err
	}
	var stdout, stderr bytes.Buffer
	output, err := streaming(ctx, "exec in "+name, name, c.containerRunning(name), func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		return c.StartExecHijacked(ctx, id, false)
	})
	if err != nil {
		return ExecResult{}, err
	}
	err = DemuxSplit(output, &stdout, &stderr)
	_ = output.Close()
	if err != nil {
		return ExecResult{}, err
	}
	code, err := c.InspectExec(ctx, id)
	if err != nil {
		return ExecResult{}, err
	}
	return ExecResult{ExitCode: code, Stderr: stderr.String(), Stdout: stdout.String()}, nil
}
