package dockerapi

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strings"

	"github.com/moby/moby/client"
)

// ImageInspect is the part of an image's inspect a deploy reads.
type ImageInspect struct {
	Architecture string `json:"Architecture"`
	Config       struct {
		ImageConfig
		Healthcheck *struct {
			Test []string `json:"Test"`
		} `json:"Healthcheck"`
	} `json:"Config"`
	ID          string   `json:"Id"`
	RepoDigests []string `json:"RepoDigests"`
}

// ImageConfig is what an image runs when a container doesn't say otherwise.
type ImageConfig struct {
	Cmd        []string `json:"Cmd"`
	Entrypoint []string `json:"Entrypoint"`
}

// Digest is the image's first registry digest, empty when it never came from
// or went to a registry.
func (i *ImageInspect) Digest() string {
	if len(i.RepoDigests) == 0 {
		return ""
	}
	_, digest, _ := strings.Cut(i.RepoDigests[0], "@")
	return digest
}

// inspectImage is the daemon's full typed inspect of an image.
func (c *Client) inspectImage(ctx context.Context, ref string) (client.ImageInspectResult, error) {
	return control(ctx, ControlTimeout, "inspect image "+ref, "", func(ctx context.Context) (client.ImageInspectResult, error) {
		return c.api.ImageInspect(ctx, ref)
	})
}

// InspectImage inspects ref, returning ErrNotFound when the daemon lacks it.
func (c *Client) InspectImage(ctx context.Context, ref string) (*ImageInspect, error) {
	result, err := c.inspectImage(ctx, ref)
	if err != nil {
		return nil, err
	}
	inspected := &ImageInspect{Architecture: result.Architecture, ID: result.ID, RepoDigests: result.RepoDigests}
	if config := result.Config; config != nil {
		inspected.Config.Cmd = config.Cmd
		inspected.Config.Entrypoint = config.Entrypoint
		if config.Healthcheck != nil {
			inspected.Config.Healthcheck = &struct {
				Test []string `json:"Test"`
			}{Test: config.Healthcheck.Test}
		}
	}
	return inspected, nil
}

// PullImageEvents pulls ref like PullImage, but hands each progress event's
// layer id along with its status, for a caller that dedupes per layer.
func (c *Client) PullImageEvents(ctx context.Context, ref string, auth *AuthConfig, onEvent func(id, status string)) error {
	encoded, err := auth.encode()
	if err != nil {
		return err
	}
	body, err := streaming(ctx, "pull "+ref, "", nil, func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		return c.api.ImagePull(ctx, ref, client.ImagePullOptions{RegistryAuth: encoded})
	})
	if err != nil {
		return err
	}
	defer func() { _ = body.Close() }()
	return followProgress(body, onEvent)
}

// LoadImage loads a `docker save` tarball into the daemon, consuming archive
// as it arrives.
func (c *Client) LoadImage(ctx context.Context, archive io.Reader) error {
	body, err := streaming(ctx, "load image", "", c.daemonAnswers, func(ctx context.Context, w *watch) (io.ReadCloser, error) {
		return c.api.ImageLoad(ctx, watchedReader{source: archive, w: w}, client.ImageLoadWithQuiet(true))
	})
	if err != nil {
		return err
	}
	defer func() { _ = body.Close() }()
	_, err = io.Copy(io.Discard, body)
	return err
}

// newJSONDecoder decodes a stream of JSON messages off body.
func newJSONDecoder(body io.Reader) *json.Decoder {
	return json.NewDecoder(bufio.NewReader(body))
}
