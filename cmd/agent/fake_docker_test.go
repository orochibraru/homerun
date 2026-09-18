package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/orochibraru/homerun/internal/dockerapi"
)

// fakeDocker is an in-memory daemon. Each git or builder container "runs" the
// script its test gives it: an exit code and some output.
type fakeDocker struct {
	mu         sync.Mutex
	calls      []string
	images     map[string]bool
	created    map[string]dockerapi.ContainerConfig
	containers int
	removed    []string
	volumes    map[string]bool
	pulled     []string
	pushed     []string
	tagged     []string
	saved      map[string]string

	// run decides what a created container does, by its config.
	run func(config dockerapi.ContainerConfig) (exitCode int, output string)
	// failOn makes the named operation fail.
	failOn map[string]error
}

func newFakeDocker() *fakeDocker {
	return &fakeDocker{
		created: map[string]dockerapi.ContainerConfig{},
		failOn:  map[string]error{},
		images:  map[string]bool{},
		saved:   map[string]string{},
		volumes: map[string]bool{},
		run: func(dockerapi.ContainerConfig) (int, string) {
			return 0, ""
		},
	}
}

func (f *fakeDocker) record(call string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, call)
	for prefix, err := range f.failOn {
		if strings.HasPrefix(call, prefix) {
			return err
		}
	}
	return nil
}

// frame wraps output in Docker's multiplexed log framing, the way a non-TTY
// container's logs come back.
func frame(output string) []byte {
	var buffer bytes.Buffer
	header := make([]byte, 8)
	header[0] = 1
	binary.BigEndian.PutUint32(header[4:], uint32(len(output)))
	buffer.Write(header)
	buffer.WriteString(output)
	return buffer.Bytes()
}

func (f *fakeDocker) Ping(context.Context) error { return f.record("ping") }

func (f *fakeDocker) ImageExists(_ context.Context, ref string) (bool, error) {
	if err := f.record("image-exists " + ref); err != nil {
		return false, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.images[ref], nil
}

func (f *fakeDocker) PullImage(_ context.Context, ref string, _ *dockerapi.AuthConfig, _ func(string)) error {
	if err := f.record("pull " + ref); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pulled = append(f.pulled, ref)
	f.images[ref] = true
	return nil
}

func (f *fakeDocker) CreateVolume(_ context.Context, name string, _ map[string]string) error {
	if err := f.record("volume-create " + name); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.volumes[name] = true
	return nil
}

func (f *fakeDocker) RemoveVolume(_ context.Context, name string) error {
	_ = f.record("volume-remove " + name)
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.volumes, name)
	return nil
}

func (f *fakeDocker) CreateContainer(_ context.Context, config dockerapi.ContainerConfig) (string, error) {
	if err := f.record("create " + config.Image + " " + strings.Join(config.Cmd, " ")); err != nil {
		return "", err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.containers++
	id := fmt.Sprintf("c%d", f.containers)
	f.created[id] = config
	return id, nil
}

func (f *fakeDocker) StartContainer(_ context.Context, id string) error {
	return f.record("start " + id)
}

func (f *fakeDocker) config(id string) dockerapi.ContainerConfig {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.created[id]
}

func (f *fakeDocker) WaitContainer(ctx context.Context, id string) (int, error) {
	if err := f.record("wait " + id); err != nil {
		return 0, err
	}
	if ctx.Err() != nil {
		return 0, ctx.Err()
	}
	code, _ := f.run(f.config(id))
	return code, nil
}

func (f *fakeDocker) ContainerLogs(_ context.Context, id string, _ bool) (io.ReadCloser, error) {
	if err := f.record("logs " + id); err != nil {
		return nil, err
	}
	_, output := f.run(f.config(id))
	return io.NopCloser(bytes.NewReader(frame(output))), nil
}

func (f *fakeDocker) KillContainer(_ context.Context, id string) error {
	return f.record("kill " + id)
}

func (f *fakeDocker) RemoveContainer(_ context.Context, id string) error {
	_ = f.record("remove " + id)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removed = append(f.removed, id)
	return nil
}

func (f *fakeDocker) TagImage(_ context.Context, source, repository, tag string) error {
	if err := f.record("tag " + source + " " + repository + ":" + tag); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tagged = append(f.tagged, repository+":"+tag)
	return nil
}

func (f *fakeDocker) PushImage(_ context.Context, repository, tag string, auth dockerapi.AuthConfig, _ func(string)) error {
	if err := f.record("push " + repository + ":" + tag + " as " + auth.Username); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pushed = append(f.pushed, repository+":"+tag)
	return nil
}

func (f *fakeDocker) SaveImage(_ context.Context, ref string) (io.ReadCloser, error) {
	if err := f.record("save " + ref); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	content, ok := f.saved[ref]
	if !ok {
		return nil, dockerapi.ErrNotFound
	}
	return io.NopCloser(strings.NewReader(content)), nil
}

func (f *fakeDocker) called(prefix string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, call := range f.calls {
		if strings.HasPrefix(call, prefix) {
			return true
		}
	}
	return false
}

var errBoom = errors.New("boom")
