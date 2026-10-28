package dockerapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/system"
	"github.com/moby/moby/api/types/volume"
	"github.com/moby/moby/client"
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

// VolumeUsage is how much a volume holds and how many containers use it.
type VolumeUsage struct {
	RefCount int   `json:"RefCount"`
	Size     int64 `json:"Size"`
}

// Volume is one entry of the daemon's volume list.
type Volume struct {
	CreatedAt  string            `json:"CreatedAt"`
	Labels     map[string]string `json:"Labels"`
	Mountpoint string            `json:"Mountpoint"`
	Name       string            `json:"Name"`
	UsageData  *VolumeUsage      `json:"UsageData"`
}

// ContainerNetworks is a listed container's networks, by name.
type ContainerNetworks struct {
	Networks map[string]json.RawMessage `json:"Networks"`
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
	ID              string             `json:"Id"`
	Image           string             `json:"Image"`
	Labels          map[string]string  `json:"Labels"`
	Names           []string           `json:"Names"`
	NetworkSettings *ContainerNetworks `json:"NetworkSettings"`
	State           string             `json:"State"`
	Status          string             `json:"Status"`
}

// Version is the part of `docker version` this app reads: the platform the
// daemon runs containers on, spelled like an image's own (linux, amd64).
type Version struct {
	Arch string `json:"Arch"`
	Os   string `json:"Os"`
}

// info is the daemon's full typed `docker info`.
func (c *Client) info(ctx context.Context) (system.Info, error) {
	result, err := control(ctx, ControlTimeout, "info", "", func(ctx context.Context) (client.SystemInfoResult, error) {
		return c.api.Info(ctx, client.InfoOptions{})
	})
	return result.Info, err
}

// SystemInfo reads `docker info`.
func (c *Client) SystemInfo(ctx context.Context) (*Info, error) {
	full, err := c.info(ctx)
	if err != nil {
		return nil, err
	}
	info := &Info{SecurityOptions: full.SecurityOptions, ServerVersion: full.ServerVersion}
	info.Swarm.ControlAvailable = full.Swarm.ControlAvailable
	info.Swarm.LocalNodeState = string(full.Swarm.LocalNodeState)
	info.Swarm.NodeID = full.Swarm.NodeID
	return info, nil
}

// ServerVersion reads `docker version`.
func (c *Client) ServerVersion(ctx context.Context) (*Version, error) {
	result, err := control(ctx, ControlTimeout, "version", "", func(ctx context.Context) (client.ServerVersionResult, error) {
		return c.api.ServerVersion(ctx, client.ServerVersionOptions{})
	})
	if err != nil {
		return nil, err
	}
	return &Version{Arch: result.Arch, Os: result.Os}, nil
}

// volumeUsage projects a volume's typed usage data.
func volumeUsage(usage *volume.UsageData) *VolumeUsage {
	if usage == nil {
		return nil
	}
	return &VolumeUsage{RefCount: int(usage.RefCount), Size: usage.Size}
}

// ListVolumes lists every volume on the daemon.
func (c *Client) ListVolumes(ctx context.Context) ([]Volume, error) {
	listed, err := control(ctx, ControlTimeout, "list volumes", "", func(ctx context.Context) (client.VolumeListResult, error) {
		return c.api.VolumeList(ctx, client.VolumeListOptions{})
	})
	if err != nil {
		return nil, err
	}
	volumes := make([]Volume, 0, len(listed.Items))
	for _, entry := range listed.Items {
		volumes = append(volumes, Volume{
			CreatedAt:  entry.CreatedAt,
			Labels:     entry.Labels,
			Mountpoint: entry.Mountpoint,
			Name:       entry.Name,
			UsageData:  volumeUsage(entry.UsageData),
		})
	}
	return volumes, nil
}

// containerNetworks projects a listed container's typed networks.
func containerNetworks(entry container.Summary) *ContainerNetworks {
	if entry.NetworkSettings == nil {
		return nil
	}
	networks := &ContainerNetworks{Networks: map[string]json.RawMessage{}}
	for name, endpoint := range entry.NetworkSettings.Networks {
		encoded, err := json.Marshal(endpoint)
		if err != nil {
			continue
		}
		networks.Networks[name] = encoded
	}
	return networks
}

// ListContainers lists containers, running ones only unless all is set, and
// filtered to one "key=value" label when label isn't empty.
func (c *Client) ListContainers(ctx context.Context, all bool, label string) ([]ContainerListEntry, error) {
	listed, err := c.listContainers(ctx, all, label)
	if err != nil {
		return nil, err
	}
	containers := make([]ContainerListEntry, 0, len(listed))
	for _, entry := range listed {
		containers = append(containers, ContainerListEntry{
			Created: entry.Created,
			HostConfig: &struct {
				NetworkMode string `json:"NetworkMode"`
			}{NetworkMode: entry.HostConfig.NetworkMode},
			ID:              entry.ID,
			Image:           entry.Image,
			Labels:          entry.Labels,
			Names:           entry.Names,
			NetworkSettings: containerNetworks(entry),
			State:           string(entry.State),
			Status:          entry.Status,
		})
	}
	return containers, nil
}

// rawObject decodes a daemon answer kept verbatim into a generic map.
func rawObject(raw json.RawMessage) (map[string]any, error) {
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

// InspectRaw inspects a container and hands back the daemon's answer whole,
// for the callers that rebuild a container from its own config (recreating
// Traefik with a changed flag) and would lose fields to a narrower struct.
func (c *Client) InspectRaw(ctx context.Context, id string) (map[string]any, error) {
	result, err := c.inspect(ctx, id)
	if err != nil {
		return nil, err
	}
	return rawObject(result.Raw)
}

// InspectImageRaw inspects an image and hands back the daemon's answer whole.
func (c *Client) InspectImageRaw(ctx context.Context, ref string) (map[string]any, error) {
	var raw bytes.Buffer
	_, err := control(ctx, ControlTimeout, "inspect image "+ref, "", func(ctx context.Context) (client.ImageInspectResult, error) {
		return c.api.ImageInspect(ctx, ref, client.ImageInspectWithRawResponse(&raw))
	})
	if err != nil {
		return nil, err
	}
	return rawObject(raw.Bytes())
}

// ContainerLogsStream opens a container's logs, following them when follow is
// set and starting from the last tail lines when tail is positive. The caller
// closes the stream, which is what stops the daemon writing to it.
func (c *Client) ContainerLogsStream(ctx context.Context, id string, tail int, follow bool) (io.ReadCloser, error) {
	return streaming(ctx, "logs "+shortID(id), id, c.containerRunning(id), func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		return c.api.ContainerLogs(ctx, id, client.ContainerLogsOptions{
			Follow:     follow,
			ShowStderr: true,
			ShowStdout: true,
			Tail:       logsTail(tail),
		})
	})
}

// RemoveContainerOpts removes a container, forcing a running one to stop first
// only when force is set, so a caller that means "remove it if it's idle"
// isn't silently killing a live workload. A container already gone isn't an
// error: the caller asked for it to not be there.
func (c *Client) RemoveContainerOpts(ctx context.Context, id string, force bool) error {
	err := discard(control(ctx, ControlTimeout, "remove "+shortID(id), id, func(ctx context.Context) (client.ContainerRemoveResult, error) {
		return c.api.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: force})
	}))
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// RemoveImage removes one image, forcing it when force is set.
func (c *Client) RemoveImage(ctx context.Context, id string, force bool) error {
	return discard(control(ctx, SlowTimeout, "remove image "+id, "", func(ctx context.Context) (client.ImageRemoveResult, error) {
		return c.api.ImageRemove(ctx, id, client.ImageRemoveOptions{Force: force, PruneChildren: true})
	}))
}

// ContainerLogsSince follows a container's logs from since onwards, every line
// prefixed with its RFC 3339 timestamp, for the log shipper. A zero since
// starts from the first line the daemon still holds. The caller closes the
// stream.
func (c *Client) ContainerLogsSince(ctx context.Context, id string, since time.Time) (io.ReadCloser, error) {
	return streaming(ctx, "ship logs "+shortID(id), id, c.containerRunning(id), func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		return c.api.ContainerLogs(ctx, id, client.ContainerLogsOptions{
			Follow:     true,
			ShowStderr: true,
			ShowStdout: true,
			Since:      logsSince(since),
			Timestamps: true,
		})
	})
}

// logsSince is since in the seconds.nanoseconds form the daemon's since
// parameter takes, empty for the zero time.
func logsSince(since time.Time) string {
	if since.IsZero() {
		return ""
	}
	return fmt.Sprintf("%d.%09d", since.Unix(), since.Nanosecond())
}
