// Package dockerapi is Homerun's Docker Engine client: a thin layer over the
// official typed SDK (github.com/moby/moby/client) that adds what the worker
// needs on top of it, per-call deadlines, the stall watchdog on streams, job
// activity tracking and the small projections of the Engine's answers the rest
// of the code and the TypeScript app read.
package dockerapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/containerd/errdefs/pkg/errhttp"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/jsonstream"
	"github.com/moby/moby/api/types/registry"
	"github.com/moby/moby/client"

	"github.com/orochibraru/homerun/internal/logging"
)

// engineScope labels every Docker Engine call in the log, so a deploy that
// misbehaves can be read as the sequence of calls it actually made.
const engineScope = "docker"

// Client is a Docker Engine API client bound to one daemon.
type Client struct {
	api *client.Client
}

// New builds a client for the daemon listening on socketPath, the Docker
// default socket when it's empty.
func New(socketPath string) *Client {
	host := client.DefaultDockerHost
	if socketPath != "" {
		host = "unix://" + socketPath
	}
	docker, err := newClient(client.WithHost(host))
	if err != nil {
		panic(fmt.Sprintf("dockerapi: building a client for %s: %s", socketPath, err))
	}
	return docker
}

var versionPrefix = regexp.MustCompile(`^/v[0-9]+\.[0-9]+/`)

// NewWithHTTP builds a client over an arbitrary HTTP client and base URL, for
// tests that stand an httptest server in for the daemon. The API version is
// pinned and stripped from every path, so a fake daemon routes on the Engine's
// unversioned paths and never has to answer the version negotiation ping.
func NewWithHTTP(httpClient *http.Client, base string) *Client {
	parsed, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil {
		panic(fmt.Sprintf("dockerapi: invalid base URL %q: %s", base, err))
	}
	docker, err := newClient(
		client.WithHTTPClient(httpClient),
		client.WithHost("tcp://"+parsed.Host),
		client.WithScheme("http"),
		client.WithAPIVersion(client.MaxAPIVersion),
		client.WithHTTPRequestHook(func(request *http.Request) error {
			request.URL.Path = versionPrefix.ReplaceAllString(request.URL.Path, "/")
			return nil
		}),
	)
	if err != nil {
		panic(fmt.Sprintf("dockerapi: building a test client for %s: %s", base, err))
	}
	return docker
}

// AuthConfig is registry credentials, sent as the X-Registry-Auth header.
type AuthConfig struct {
	Password      string `json:"password"`
	ServerAddress string `json:"serveraddress"`
	Username      string `json:"username"`
}

// encode is auth as the base64 X-Registry-Auth value, empty for no auth.
func (a *AuthConfig) encode() (string, error) {
	if a == nil {
		return "", nil
	}
	encoded, err := json.Marshal(registry.AuthConfig{
		Password:      a.Password,
		ServerAddress: a.ServerAddress,
		Username:      a.Username,
	})
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(encoded), nil
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

// Decode builds one of the SDK's typed request bodies (a container.CreateRequest,
// a swarm.ServiceSpec, a NetworkSpec) from a raw Engine API body the app sent
// over JSON, so every field reaches the daemon through the SDK's own types.
func Decode[T any](body map[string]any) (T, error) {
	var typed T
	encoded, err := json.Marshal(body)
	if err != nil {
		return typed, err
	}
	err = json.Unmarshal(encoded, &typed)
	return typed, err
}

// ErrNotFound is returned when the daemon answers 404.
var ErrNotFound = errors.New("not found")

// normalize maps the SDK's error classes onto this package's: anything the
// daemon reports as missing wraps ErrNotFound, keeping its own message.
func normalize(err error) error {
	if err == nil || errors.Is(err, ErrNotFound) || !cerrdefs.IsNotFound(err) {
		return err
	}
	return fmt.Errorf("%w: %s", ErrNotFound, err.Error())
}

// Status is the HTTP status the daemon answered a failed call with, or 0 when
// err isn't a daemon answer at all (a dropped connection, a stall).
func Status(err error) int {
	if err == nil || IsStall(err) || client.IsErrConnectionFailed(err) {
		return 0
	}
	if errors.Is(err, ErrNotFound) {
		return http.StatusNotFound
	}
	if status := errhttp.ToHTTP(err); status != http.StatusInternalServerError || cerrdefs.IsInternal(err) {
		return status
	}
	return 0
}

// logCall records one Engine call, its outcome and how long it took.
func logCall(call string, started time.Time, err error) {
	elapsed := time.Since(started).Round(time.Millisecond)
	if err != nil {
		logging.Debugf(engineScope, "%s failed after %s: %s", call, elapsed, err)
		return
	}
	logging.Debugf(engineScope, "%s ok (%s)", call, elapsed)
}

// Ping checks the daemon answers.
func (c *Client) Ping(ctx context.Context) error {
	return discard(control(ctx, ControlTimeout, "ping", "", func(ctx context.Context) (client.PingResult, error) {
		return c.api.Ping(ctx, client.PingOptions{})
	}))
}

// ImageExists reports whether ref is present on the daemon.
func (c *Client) ImageExists(ctx context.Context, ref string) (bool, error) {
	_, err := c.InspectImage(ctx, ref)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// SplitRef splits an image ref into its repository and tag, defaulting the tag
// to latest. A colon inside the registry host (a port) isn't mistaken for one,
// and a digest-pinned ref (repo@sha256:..., with or without a tag before it)
// comes back as its repository and the digest.
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

// joinRef is SplitRef's inverse: repository with a tag, or a digest after @.
func joinRef(repository, tag string) string {
	if strings.Contains(tag, ":") {
		return repository + "@" + tag
	}
	return repository + ":" + tag
}

// RegistryHost is the host (and port) a registry address logs in against,
// without any scheme or the namespace path a registry like Gitea or GHCR needs
// in front of every repository.
func RegistryHost(address string) string {
	host := strings.TrimPrefix(strings.TrimPrefix(address, "https://"), "http://")
	host, _, _ = strings.Cut(host, "/")
	return host
}

// PullImage pulls ref, forwarding each progress status line to onProgress when
// given. A failure the daemon only reports inside the progress stream is
// returned as an error, as it would be by the docker CLI.
func (c *Client) PullImage(ctx context.Context, ref string, auth *AuthConfig, onProgress func(string)) error {
	return c.PullImageEvents(ctx, ref, auth, func(_, status string) {
		if onProgress != nil {
			onProgress(status)
		}
	})
}

// TagImage tags source as repository:tag.
func (c *Client) TagImage(ctx context.Context, source, repository, tag string) error {
	return discard(control(ctx, ControlTimeout, "tag "+source, "", func(ctx context.Context) (client.ImageTagResult, error) {
		return c.api.ImageTag(ctx, client.ImageTagOptions{Source: source, Target: joinRef(repository, tag)})
	}))
}

// PushImage pushes repository:tag with auth, forwarding progress to onProgress
// when given. A failure reported inside the progress stream is an error.
func (c *Client) PushImage(ctx context.Context, repository, tag string, auth AuthConfig, onProgress func(string)) error {
	encoded, err := auth.encode()
	if err != nil {
		return err
	}
	ref := joinRef(repository, tag)
	body, err := streaming(ctx, "push "+ref, "", nil, func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		return c.api.ImagePush(ctx, ref, client.ImagePushOptions{RegistryAuth: encoded})
	})
	if err != nil {
		return err
	}
	defer func() { _ = body.Close() }()
	return followProgress(body, func(_, status string) {
		if onProgress != nil {
			onProgress(status)
		}
	})
}

// SaveImage streams ref as a `docker save` tarball. Returns ErrNotFound when
// the daemon doesn't have it. The caller closes the stream.
func (c *Client) SaveImage(ctx context.Context, ref string) (io.ReadCloser, error) {
	return streaming(ctx, "save "+ref, "", nil, func(ctx context.Context, _ *watch) (io.ReadCloser, error) {
		return c.api.ImageSave(ctx, []string{ref})
	})
}

// CreateContainer creates a container and returns its id. Tty is always off,
// so its logs come back multiplexed (see Demux).
func (c *Client) CreateContainer(ctx context.Context, config ContainerConfig) (string, error) {
	return c.CreateContainerOn(ctx, config, "")
}

// StartContainer starts a created container. One already running isn't an
// error: the daemon answers 304, which the SDK takes as success.
func (c *Client) StartContainer(ctx context.Context, id string) error {
	return discard(control(ctx, ControlTimeout, "start "+shortID(id), id, func(ctx context.Context) (client.ContainerStartResult, error) {
		return c.api.ContainerStart(ctx, id, client.ContainerStartOptions{})
	}))
}

// WaitContainer blocks until the container exits and returns its exit code.
// There's no deadline on the wait itself: while the container runs, the stall
// watchdog keeps checking the daemon still answers for it, and gives up with a
// StallError once it doesn't.
func (c *Client) WaitContainer(ctx context.Context, id string) (int, error) {
	call := "wait " + shortID(id)
	w, callCtx := newWatch(ctx, call, id, c.containerRunning(id))
	defer w.stop()
	started := time.Now()
	waited := c.api.ContainerWait(callCtx, id, client.ContainerWaitOptions{Condition: container.WaitConditionNotRunning})
	select {
	case response := <-waited.Result:
		logCall(call, started, nil)
		if response.Error != nil && response.Error.Message != "" {
			return int(response.StatusCode), errors.New(response.Error.Message)
		}
		return int(response.StatusCode), nil
	case err := <-waited.Error:
		logCall(call, started, err)
		return 0, normalize(w.explain(err))
	}
}

// ContainerLogs opens the container's stdout and stderr, multiplexed (see
// Demux). With follow the stream stays open until the container exits. The
// caller closes the stream.
func (c *Client) ContainerLogs(ctx context.Context, id string, follow bool) (io.ReadCloser, error) {
	return c.ContainerLogsStream(ctx, id, 0, follow)
}

// KillContainer kills a running container. A container that already stopped
// or is gone isn't an error.
func (c *Client) KillContainer(ctx context.Context, id string) error {
	err := discard(control(ctx, ControlTimeout, "kill "+shortID(id), id, func(ctx context.Context) (client.ContainerKillResult, error) {
		return c.api.ContainerKill(ctx, id, client.ContainerKillOptions{})
	}))
	if errors.Is(err, ErrNotFound) || cerrdefs.IsConflict(err) {
		return nil
	}
	return err
}

// RemoveContainer force-removes a container. One that's already gone isn't an error.
func (c *Client) RemoveContainer(ctx context.Context, id string) error {
	return c.RemoveContainerOpts(ctx, id, true)
}

// CreateVolume creates a named volume with labels.
func (c *Client) CreateVolume(ctx context.Context, name string, labels map[string]string) error {
	return discard(control(ctx, ControlTimeout, "create volume "+name, "", func(ctx context.Context) (client.VolumeCreateResult, error) {
		return c.api.VolumeCreate(ctx, client.VolumeCreateOptions{Labels: labels, Name: name})
	}))
}

// VolumeExists reports whether a named volume exists on the daemon.
func (c *Client) VolumeExists(ctx context.Context, name string) (bool, error) {
	err := discard(control(ctx, ControlTimeout, "inspect volume "+name, "", func(ctx context.Context) (client.VolumeInspectResult, error) {
		return c.api.VolumeInspect(ctx, name, client.VolumeInspectOptions{})
	}))
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// RemoveVolume force-removes a volume. One that's already gone isn't an error.
func (c *Client) RemoveVolume(ctx context.Context, name string) error {
	err := discard(control(ctx, ControlTimeout, "remove volume "+name, "", func(ctx context.Context) (client.VolumeRemoveResult, error) {
		return c.api.VolumeRemove(ctx, name, client.VolumeRemoveOptions{Force: true})
	}))
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// progressMessage is one line of a pull or push progress stream: the SDK's
// typed message, plus the legacy top-level error string older daemons send.
type progressMessage struct {
	jsonstream.Message
	ErrorMessage string `json:"error,omitempty"`
}

// followProgress reads a pull or push progress stream to the end, forwarding
// each event's layer id and status, and returning the first error the daemon
// reports in it.
func followProgress(body io.Reader, onEvent func(id, status string)) error {
	decoder := newJSONDecoder(body)
	for {
		var message progressMessage
		if err := decoder.Decode(&message); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		if message.Error != nil && message.Error.Message != "" {
			return errors.New(message.Error.Message)
		}
		if message.ErrorMessage != "" {
			return errors.New(message.ErrorMessage)
		}
		if onEvent != nil && message.Status != "" {
			onEvent(message.ID, message.Status)
		}
	}
}
