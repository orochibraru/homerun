package dockerapi

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

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
	response, err := c.request(ctx, http.MethodPost, "/containers/create", nil, body, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = response.Body.Close() }()
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		return "", err
	}
	return created.ID, nil
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

// DemuxSplit copies a multiplexed log stream like Demux, but keeps stdout and
// stderr apart, for a helper whose stdout is machine-readable output.
func DemuxSplit(stream io.Reader, stdout, stderr io.Writer) error {
	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(stream, header); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		}
		target := stdout
		if header[0] == 2 {
			target = stderr
		}
		size := int64(binary.BigEndian.Uint32(header[4:]))
		if _, err := io.CopyN(target, stream, size); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}
