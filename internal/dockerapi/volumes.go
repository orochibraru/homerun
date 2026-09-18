package dockerapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// ContainerArchive streams path inside a container (running or not) as an
// uncompressed tar. A path ending in "/." yields the directory's contents as
// "./..." entries, like `tar -C path .`. The caller closes the stream.
func (c *Client) ContainerArchive(ctx context.Context, id, path string) (io.ReadCloser, error) {
	response, err := c.request(ctx, http.MethodGet, "/containers/"+id+"/archive", url.Values{"path": {path}}, nil, nil)
	if err != nil {
		return nil, err
	}
	return response.Body, nil
}

// PutContainerArchive unpacks a tar stream (gzipped is fine, the daemon sniffs
// it) into path inside a container, which doesn't need to be running.
func (c *Client) PutContainerArchive(ctx context.Context, id, path string, archive io.Reader) error {
	endpoint := c.base + "/containers/" + id + "/archive?" + url.Values{"path": {path}}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, archive)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-tar")
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	var decoded struct {
		Message string `json:"message"`
	}
	message := strings.TrimSpace(string(raw))
	if json.Unmarshal(raw, &decoded) == nil && decoded.Message != "" {
		message = decoded.Message
	}
	return &APIError{Message: message, Status: response.StatusCode}
}

func ignoreNotModified(err error) error {
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusNotModified {
		return nil
	}
	return err
}

// StopContainer stops a container. One already stopped isn't an error.
func (c *Client) StopContainer(ctx context.Context, id string) error {
	return ignoreNotModified(c.call(ctx, http.MethodPost, "/containers/"+id+"/stop", nil, nil))
}

// EnsureContainerStarted starts a container. One already running isn't an error.
func (c *Client) EnsureContainerStarted(ctx context.Context, id string) error {
	return ignoreNotModified(c.StartContainer(ctx, id))
}

// ScaleSwarmService sets a replicated swarm service's replica count, keeping
// the rest of its spec: swarm's own "stop" (0) and "start" (its usual count).
func (c *Client) ScaleSwarmService(ctx context.Context, id string, replicas int) error {
	response, err := c.request(ctx, http.MethodGet, "/services/"+id, nil, nil, nil)
	if err != nil {
		return err
	}
	var inspected struct {
		Spec    map[string]any `json:"Spec"`
		Version struct {
			Index int64 `json:"Index"`
		} `json:"Version"`
	}
	err = json.NewDecoder(response.Body).Decode(&inspected)
	_ = response.Body.Close()
	if err != nil {
		return fmt.Errorf("couldn't read swarm service %s: %w", id, err)
	}
	if inspected.Spec == nil {
		return fmt.Errorf("swarm service %s has no spec", id)
	}
	inspected.Spec["Mode"] = map[string]any{"Replicated": map[string]any{"Replicas": replicas}}
	return c.call(ctx, http.MethodPost, "/services/"+id+"/update",
		url.Values{"version": {strconv.FormatInt(inspected.Version.Index, 10)}}, inspected.Spec)
}
