package imagescan

import (
	"bytes"
	"context"
	"errors"
	"os"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
)

const (
	// TrivyImage is the scanner image Scan runs.
	TrivyImage  = "aquasec/trivy:0.74.0"
	cacheVolume = "homerun-trivy-cache"
	scanTimeout = 20 * time.Minute
)

// Source is where Trivy reads the image from: "remote" (a registry, Insecure
// allowing plain HTTP), "docker" (the local daemon) or "any" (either).
type Source struct {
	Insecure bool   `json:"insecure"`
	Kind     string `json:"kind"`
}

// Target is one image to scan, with the registry credentials Trivy needs.
type Target struct {
	Auth   *dockerapi.AuthConfig `json:"auth"`
	Ref    string                `json:"ref"`
	Source Source                `json:"source"`
}

// Command is the `trivy image` argument list scanning ref from source.
func Command(ref string, source Source) []string {
	var from []string
	switch source.Kind {
	case "remote":
		from = []string{"--image-src", "remote"}
		if source.Insecure {
			from = append(from, "--insecure")
		}
	case "docker":
		from = []string{"--image-src", "docker"}
	default:
		from = []string{"--image-src", "docker,remote"}
	}
	args := append([]string{"image"}, from...)
	return append(args,
		"--format", "json", "--quiet", "--scanners", "vuln",
		"--severity", "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL", "--timeout", "15m", ref)
}

// hostSocketPath is the daemon socket's path on the real host: when the worker
// runs in a container, the source of its own mount of socket, else socket.
func hostSocketPath(ctx context.Context, docker *dockerapi.Client, socket string) string {
	self, err := os.Hostname()
	if err != nil {
		return socket
	}
	source, err := docker.MountSource(ctx, self, socket)
	if err != nil || source == "" {
		return socket
	}
	return source
}

// Scan runs Trivy against target in a one-off container on network, mounting
// the daemon socket unless the image comes from a registry only, and returns
// the summarised report. It pulls the Trivy image first when missing, kills
// the scanner after 20 minutes and always removes its container.
func Scan(ctx context.Context, docker *dockerapi.Client, socket, network string, target Target) (Summary, error) {
	exists, err := docker.ImageExists(ctx, TrivyImage)
	if err != nil {
		return Summary{}, err
	}
	if !exists {
		if err := docker.PullImage(ctx, TrivyImage, nil, nil); err != nil {
			return Summary{}, err
		}
	}
	binds := []string{cacheVolume + ":/root/.cache"}
	if target.Source.Kind != "remote" {
		binds = append(binds, hostSocketPath(ctx, docker, socket)+":/var/run/docker.sock")
	}
	var env []string
	if target.Auth != nil {
		env = []string{"TRIVY_PASSWORD=" + target.Auth.Password, "TRIVY_USERNAME=" + target.Auth.Username}
	}
	id, err := docker.CreateContainerOn(ctx, dockerapi.ContainerConfig{
		Binds:  binds,
		Cmd:    Command(target.Ref, target.Source),
		Env:    env,
		Image:  TrivyImage,
		Labels: map[string]string{"homerun.managed": "true"},
	}, network)
	if err != nil {
		return Summary{}, err
	}
	defer func() { _ = docker.RemoveContainer(context.WithoutCancel(ctx), id) }()
	if err := docker.StartContainer(ctx, id); err != nil {
		return Summary{}, err
	}
	waitCtx, cancel := context.WithTimeout(ctx, scanTimeout)
	defer cancel()
	code, err := docker.WaitContainer(waitCtx, id)
	if err != nil {
		_ = docker.KillContainer(context.WithoutCancel(ctx), id)
		if ctx.Err() == nil && errors.Is(waitCtx.Err(), context.DeadlineExceeded) {
			return Summary{}, errors.New("the scanner timed out")
		}
		return Summary{}, err
	}
	logs, err := docker.ContainerLogs(ctx, id, false)
	if err != nil {
		return Summary{}, err
	}
	defer func() { _ = logs.Close() }()
	var stdout, stderr bytes.Buffer
	if err := dockerapi.DemuxSplit(logs, &stdout, &stderr); err != nil {
		return Summary{}, err
	}
	if code != 0 {
		return Summary{}, errors.New(LastErrorLine(stderr.String()))
	}
	return Summarize(stdout.Bytes(), MaxStoredFindings)
}
