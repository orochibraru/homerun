// Package dockerapi is a small Docker Engine API client over a unix socket,
// covering exactly what Homerun's agent needs: images, one-off containers,
// volumes, logs and push/save. It talks the Engine's HTTP API directly with the
// standard library rather than pulling in the Docker SDK, which would multiply
// the agent binary's size for a dozen endpoints.
package dockerapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// Client is a Docker Engine API client bound to one daemon socket.
type Client struct {
	http *http.Client
	// Base is the client's base URL ("http://docker" over a unix socket, or an
	// httptest server's URL in a test).
	Base string
}

// New builds a client for the daemon listening on socketPath.
func New(socketPath string) *Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socketPath)
		},
	}
	return &Client{http: &http.Client{Transport: transport}, Base: "http://docker"}
}

// NewWithHTTP builds a client over an arbitrary HTTP client and base URL, for
// tests that stand an httptest server in for the daemon.
func NewWithHTTP(client *http.Client, base string) *Client {
	return &Client{http: client, Base: strings.TrimRight(base, "/")}
}

// AuthConfig is registry credentials, sent as the X-Registry-Auth header.
type AuthConfig struct {
	Password      string `json:"password"`
	ServerAddress string `json:"serveraddress"`
	Username      string `json:"username"`
}

// ContainerConfig is the subset of a container create request the agent uses.
type ContainerConfig struct {
	Binds      []string
	Cmd        []string
	Entrypoint []string
	Env        []string
	Image      string
	Labels     map[string]string
}

// ErrNotFound is returned when the daemon answers 404.
var ErrNotFound = errors.New("not found")

// APIError is a non-2xx answer from the daemon, carrying its message.
type APIError struct {
	Message string
	Status  int
}

// Error renders the daemon's status and message.
func (e *APIError) Error() string {
	return fmt.Sprintf("docker: %d %s", e.Status, e.Message)
}

// request sends one call, with an optional JSON body and registry auth, and
// returns the open response for a 2xx, or an error carrying the daemon's own
// message otherwise. The caller closes the body.
func (c *Client) request(
	ctx context.Context,
	method, path string,
	query url.Values,
	body any,
	auth *AuthConfig,
) (*http.Response, error) {
	endpoint := c.Base + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if auth != nil {
		encoded, err := json.Marshal(auth)
		if err != nil {
			return nil, err
		}
		request.Header.Set("X-Registry-Auth", base64.URLEncoding.EncodeToString(encoded))
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	defer func() { _ = response.Body.Close() }()
	raw, _ := io.ReadAll(response.Body)
	var decoded struct {
		Message string `json:"message"`
	}
	message := strings.TrimSpace(string(raw))
	if json.Unmarshal(raw, &decoded) == nil && decoded.Message != "" {
		message = decoded.Message
	}
	if response.StatusCode == http.StatusNotFound {
		if message == "" {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("%w: %s", ErrNotFound, message)
	}
	return nil, &APIError{Message: message, Status: response.StatusCode}
}

// Call sends one request and discards a successful body.
func (c *Client) Call(ctx context.Context, method, path string, query url.Values, body any) error {
	response, err := c.request(ctx, method, path, query, body, nil)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, response.Body)
	return response.Body.Close()
}

// Ping checks the daemon answers.
func (c *Client) Ping(ctx context.Context) error {
	return c.Call(ctx, http.MethodGet, "/_ping", nil, nil)
}

// ImageExists reports whether ref is present on the daemon.
func (c *Client) ImageExists(ctx context.Context, ref string) (bool, error) {
	err := c.Call(ctx, http.MethodGet, "/images/"+ref+"/json", nil, nil)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// SplitRef splits an image ref into its repository and tag, defaulting the tag
// to latest. A colon inside the registry host (a port) isn't mistaken for one,
// and a digest-pinned ref (repo@sha256:..., with or without a tag before it)
// comes back as its repository and the digest, which the Engine API accepts in
// place of a tag.
func SplitRef(ref string) (string, string) {
	if at := strings.Index(ref, "@"); at != -1 {
		repository, _ := SplitRef(ref[:at])
		return repository, ref[at+1:]
	}
	lastColon := strings.LastIndex(ref, ":")
	lastSlash := strings.LastIndex(ref, "/")
	if lastColon == -1 || lastColon < lastSlash {
		return ref, "latest"
	}
	return ref[:lastColon], ref[lastColon+1:]
}

// PullImage pulls ref, forwarding each progress status line to onProgress when
// given. A failure the daemon only reports inside the progress stream is
// returned as an error, as it would be by the docker CLI.
func (c *Client) PullImage(ctx context.Context, ref string, auth *AuthConfig, onProgress func(string)) error {
	repository, tag := SplitRef(ref)
	response, err := c.request(ctx, http.MethodPost, "/images/create",
		url.Values{"fromImage": {repository}, "tag": {tag}}, nil, auth)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return followProgress(response.Body, onProgress)
}

// TagImage tags source as repository:tag.
func (c *Client) TagImage(ctx context.Context, source, repository, tag string) error {
	return c.Call(ctx, http.MethodPost, "/images/"+source+"/tag",
		url.Values{"repo": {repository}, "tag": {tag}}, nil)
}

// PushImage pushes repository:tag with auth, forwarding progress to onProgress
// when given. A failure reported inside the progress stream is an error.
func (c *Client) PushImage(ctx context.Context, repository, tag string, auth AuthConfig, onProgress func(string)) error {
	response, err := c.request(ctx, http.MethodPost, "/images/"+repository+"/push",
		url.Values{"tag": {tag}}, nil, &auth)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return followProgress(response.Body, onProgress)
}

// SaveImage streams ref as a `docker save` tarball. Returns ErrNotFound when
// the daemon doesn't have it. The caller closes the stream.
func (c *Client) SaveImage(ctx context.Context, ref string) (io.ReadCloser, error) {
	response, err := c.request(ctx, http.MethodGet, "/images/"+ref+"/get", nil, nil, nil)
	if err != nil {
		return nil, err
	}
	return response.Body, nil
}

// CreateContainer creates a container and returns its id. Tty is always off,
// so its logs come back multiplexed (see Demux).
func (c *Client) CreateContainer(ctx context.Context, config ContainerConfig) (string, error) {
	body := map[string]any{
		"Cmd":        config.Cmd,
		"Entrypoint": config.Entrypoint,
		"Env":        config.Env,
		"HostConfig": map[string]any{"Binds": config.Binds},
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

// StartContainer starts a created container.
func (c *Client) StartContainer(ctx context.Context, id string) error {
	return c.Call(ctx, http.MethodPost, "/containers/"+id+"/start", nil, nil)
}

// WaitContainer blocks until the container exits and returns its exit code.
func (c *Client) WaitContainer(ctx context.Context, id string) (int, error) {
	response, err := c.request(ctx, http.MethodPost, "/containers/"+id+"/wait", nil, nil, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = response.Body.Close() }()
	var waited struct {
		StatusCode int `json:"StatusCode"`
	}
	if err := json.NewDecoder(response.Body).Decode(&waited); err != nil {
		return 0, err
	}
	return waited.StatusCode, nil
}

// ContainerLogs opens the container's stdout and stderr, multiplexed (see
// Demux). With follow the stream stays open until the container exits. The
// caller closes the stream.
func (c *Client) ContainerLogs(ctx context.Context, id string, follow bool) (io.ReadCloser, error) {
	query := url.Values{"stdout": {"1"}, "stderr": {"1"}}
	if follow {
		query.Set("follow", "1")
	}
	response, err := c.request(ctx, http.MethodGet, "/containers/"+id+"/logs", query, nil, nil)
	if err != nil {
		return nil, err
	}
	return response.Body, nil
}

// KillContainer kills a running container. A container that already stopped
// or is gone isn't an error.
func (c *Client) KillContainer(ctx context.Context, id string) error {
	err := c.Call(ctx, http.MethodPost, "/containers/"+id+"/kill", nil, nil)
	var apiErr *APIError
	if errors.Is(err, ErrNotFound) || (errors.As(err, &apiErr) && apiErr.Status == http.StatusConflict) {
		return nil
	}
	return err
}

// RemoveContainer force-removes a container. One that's already gone isn't an error.
func (c *Client) RemoveContainer(ctx context.Context, id string) error {
	err := c.Call(ctx, http.MethodDelete, "/containers/"+id, url.Values{"force": {"1"}}, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// CreateVolume creates a named volume with labels.
func (c *Client) CreateVolume(ctx context.Context, name string, labels map[string]string) error {
	return c.Call(ctx, http.MethodPost, "/volumes/create", nil,
		map[string]any{"Labels": labels, "Name": name})
}

// RemoveVolume force-removes a volume. One that's already gone isn't an error.
func (c *Client) RemoveVolume(ctx context.Context, name string) error {
	err := c.Call(ctx, http.MethodDelete, "/volumes/"+name, url.Values{"force": {"1"}}, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// followProgress reads a pull or push progress stream to the end, forwarding
// each status line and returning the first error the daemon reports in it.
func followProgress(body io.Reader, onProgress func(string)) error {
	decoder := json.NewDecoder(bufio.NewReader(body))
	for {
		var message struct {
			Error       string `json:"error"`
			ErrorDetail struct {
				Message string `json:"message"`
			} `json:"errorDetail"`
			Status string `json:"status"`
		}
		if err := decoder.Decode(&message); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		if message.ErrorDetail.Message != "" {
			return errors.New(message.ErrorDetail.Message)
		}
		if message.Error != "" {
			return errors.New(message.Error)
		}
		if onProgress != nil && message.Status != "" {
			onProgress(message.Status)
		}
	}
}
