package dockerapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// ignoreNotModified turns a 304 APIError into nil, for a stop/start on a
// container already in that state.
func ignoreNotModified(err error) error {
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusNotModified {
		return nil
	}
	return err
}

// StopContainer stops a container. One already stopped isn't an error.
func (c *Client) StopContainer(ctx context.Context, id string) error {
	return ignoreNotModified(c.Call(ctx, http.MethodPost, "/containers/"+id+"/stop", nil, nil))
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
	return c.Call(ctx, http.MethodPost, "/services/"+id+"/update",
		url.Values{"version": {strconv.FormatInt(inspected.Version.Index, 10)}}, inspected.Spec)
}
