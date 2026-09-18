package dockerapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

// EnsureNetwork creates a network from a raw create body, reporting whether it
// was created: one that already exists (a 409, or an overlay's "already
// exists" message) isn't an error.
func (c *Client) EnsureNetwork(ctx context.Context, body map[string]any) (bool, error) {
	err := c.call(ctx, http.MethodPost, "/networks/create", nil, body)
	var apiErr *APIError
	if errors.As(err, &apiErr) && (apiErr.Status == http.StatusConflict || strings.Contains(apiErr.Message, "already exists")) {
		return false, nil
	}
	return err == nil, err
}

// ConnectNetwork attaches a container to a network under aliases.
func (c *Client) ConnectNetwork(ctx context.Context, network, containerID string, aliases []string) error {
	return c.call(ctx, http.MethodPost, "/networks/"+network+"/connect", nil, map[string]any{
		"Container":      containerID,
		"EndpointConfig": map[string]any{"Aliases": aliases},
	})
}
