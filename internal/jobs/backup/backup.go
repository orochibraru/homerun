// Package backup executes backup and backup_restore jobs for the homerun
// worker: a volume's contents streamed as a gzipped tar to S3-compatible
// storage, and a stored archive unpacked back into the volume, with the
// services using it optionally stopped around the work.
package backup

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/s3"
)

const (
	preCommandTimeout = 15 * time.Minute
	outputTailChars   = 2000
	cleanupTimeout    = 2 * time.Minute
)

// Service is one service using the volume that is stopped around the work:
// its single container, or its swarm service scaled to 0 and back to Replicas.
type Service struct {
	ContainerID    string `json:"containerId"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	Replicas       int    `json:"replicas"`
	SwarmServiceID string `json:"swarmServiceId"`
}

// PreCommand is a shell command run inside a service's container before a backup.
type PreCommand struct {
	Command     string `json:"command"`
	ContainerID string `json:"containerId"`
	ServiceName string `json:"serviceName"`
}

// Spec is what the app's prepare step resolves for one backup or restore.
type Spec struct {
	Destination  s3.Client         `json:"destination"`
	HelperImage  string            `json:"helperImage"`
	HelperLabels map[string]string `json:"helperLabels"`
	Key          string            `json:"key"`
	MountPath    string            `json:"mountPath"`
	PreCommand   *PreCommand       `json:"preCommand"`
	Source       string            `json:"source"`
	StopServices []Service         `json:"stopServices"`
	VolumeName   string            `json:"volumeName"`
	Wipe         bool              `json:"wipe"`
}

// Run executes a backup or a backup_restore job and returns the archive's key
// and size in bytes.
func Run(ctx context.Context, job jobs.Job) (map[string]any, error) {
	var spec Spec
	if err := job.DecodeSpec(&spec); err != nil {
		return nil, fmt.Errorf("invalid backup spec: %w", err)
	}
	docker := dockerapi.New(job.DockerSocket)
	var size int64
	var err error
	if job.Type == "backup_restore" {
		size, err = restore(ctx, job, docker, spec)
	} else {
		size, err = backup(ctx, job, docker, spec)
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"key": spec.Key, "sizeBytes": size}, nil
}

// backup stops spec's services, archives and uploads the volume, then starts
// them again.
func backup(ctx context.Context, job jobs.Job, docker *dockerapi.Client, spec Spec) (int64, error) {
	if err := runPreCommand(ctx, job, docker, spec.PreCommand); err != nil {
		return 0, err
	}
	var size int64
	err := whileStopped(ctx, job, docker, spec.StopServices, func() error {
		var err error
		size, err = archiveAndUpload(ctx, docker, spec)
		return err
	})
	if err != nil {
		return 0, err
	}
	job.AppendLog(fmt.Sprintf("Uploaded %s (%d bytes)", spec.Key, size))
	return size, nil
}

// restore downloads spec's backup and extracts it into the volume, wiping it
// first when spec.Wipe is set, with services stopped throughout.
func restore(ctx context.Context, job jobs.Job, docker *dockerapi.Client, spec Spec) (int64, error) {
	archive, size, err := download(ctx, spec)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = archive.Close()
		_ = os.Remove(archive.Name())
	}()
	job.AppendLog(fmt.Sprintf("Downloaded %s (%d bytes)", spec.Key, size))
	err = whileStopped(ctx, job, docker, spec.StopServices, func() error {
		if spec.Wipe {
			if err := wipe(ctx, docker, spec); err != nil {
				return err
			}
			job.AppendLog("Volume wiped before restore")
		}
		if _, err := archive.Seek(0, io.SeekStart); err != nil {
			return err
		}
		return WithHelper(ctx, docker, spec, false, func(id string) error {
			return docker.PutContainerArchive(ctx, id, spec.MountPath, archive)
		})
	})
	if err != nil {
		return 0, err
	}
	job.AppendLog(fmt.Sprintf("Restored %s into %s (wipe=%t)", spec.Key, spec.VolumeName, spec.Wipe))
	return size, nil
}

// download fetches spec's backup into a temp file and returns it along with
// its size.
func download(ctx context.Context, spec Spec) (*os.File, int64, error) {
	stream, err := spec.Destination.Get(ctx, spec.Key)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = stream.Close() }()
	file, err := os.CreateTemp("", "homerun-restore-*.tar.gz")
	if err != nil {
		return nil, 0, err
	}
	size, err := io.Copy(file, stream)
	if err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return nil, 0, fmt.Errorf("couldn't download %s: %w", spec.Key, err)
	}
	return file, size, nil
}

// EnsureImage pulls image if the daemon doesn't already have it.
func EnsureImage(ctx context.Context, docker *dockerapi.Client, image string) error {
	exists, err := docker.ImageExists(ctx, image)
	if err != nil || exists {
		return err
	}
	return docker.PullImage(ctx, image, nil, nil)
}

// WithHelper runs a throwaway helper container with spec's volume mounted at
// spec.MountPath (read-only when readOnly), passing its id to work, and
// always removes it afterward.
func WithHelper(ctx context.Context, docker *dockerapi.Client, spec Spec, readOnly bool, work func(id string) error) error {
	if err := EnsureImage(ctx, docker, spec.HelperImage); err != nil {
		return err
	}
	bind := spec.Source + ":" + spec.MountPath
	if readOnly {
		bind += ":ro"
	}
	id, err := docker.CreateContainer(ctx, dockerapi.ContainerConfig{
		Binds: []string{bind}, Entrypoint: []string{"true"}, Image: spec.HelperImage, Labels: spec.HelperLabels,
	})
	if err != nil {
		return err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
		defer cancel()
		_ = docker.RemoveContainer(cleanup, id)
	}()
	return work(id)
}

// archiveAndUpload tars the volume through a helper container, gzips it on
// the fly, and streams it to spec.Destination.
func archiveAndUpload(ctx context.Context, docker *dockerapi.Client, spec Spec) (int64, error) {
	var size int64
	err := WithHelper(ctx, docker, spec, true, func(id string) error {
		tarball, err := docker.ContainerArchive(ctx, id, spec.MountPath+"/.")
		if err != nil {
			return fmt.Errorf("couldn't read the volume %q: %w", spec.VolumeName, err)
		}
		defer func() { _ = tarball.Close() }()
		reader, writer := io.Pipe()
		defer func() { _ = reader.Close() }()
		go func() {
			gz := gzip.NewWriter(writer)
			_, err := io.Copy(gz, tarball)
			if err == nil {
				err = gz.Close()
			}
			_ = writer.CloseWithError(err)
		}()
		size, err = spec.Destination.Upload(ctx, spec.Key, reader)
		return err
	})
	return size, err
}

// wipe deletes every file in the volume through a helper container, before a
// restore that wants a clean slate.
func wipe(ctx context.Context, docker *dockerapi.Client, spec Spec) error {
	if err := EnsureImage(ctx, docker, spec.HelperImage); err != nil {
		return err
	}
	id, err := docker.CreateContainer(ctx, dockerapi.ContainerConfig{
		Binds:  []string{spec.Source + ":" + spec.MountPath},
		Cmd:    []string{"find", spec.MountPath, "-mindepth", "1", "-delete"},
		Image:  spec.HelperImage,
		Labels: spec.HelperLabels,
	})
	if err != nil {
		return err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
		defer cancel()
		_ = docker.RemoveContainer(cleanup, id)
	}()
	if err := docker.StartContainer(ctx, id); err != nil {
		return err
	}
	code, err := docker.WaitContainer(ctx, id)
	if err != nil {
		return err
	}
	if code == 0 {
		return nil
	}
	var stderr strings.Builder
	if logs, err := docker.ContainerLogs(ctx, id, false); err == nil {
		_ = dockerapi.DemuxSplit(logs, io.Discard, &stderr)
		_ = logs.Close()
	}
	return fmt.Errorf("Couldn't wipe %q before restoring (exit %d)%s", spec.VolumeName, code, detail(stderr.String()))
}

// runPreCommand runs pre's command inside its container before the backup,
// failing the job on a non-zero exit or a 15-minute timeout.
func runPreCommand(ctx context.Context, job jobs.Job, docker *dockerapi.Client, pre *PreCommand) error {
	if pre == nil || strings.TrimSpace(pre.Command) == "" {
		return nil
	}
	job.AppendLog(fmt.Sprintf("Running the pre-backup command in %q", pre.ServiceName))
	execCtx, cancel := context.WithTimeout(ctx, preCommandTimeout)
	defer cancel()
	result, err := docker.ContainerExec(execCtx, pre.ContainerID, []string{"/bin/sh", "-c", pre.Command})
	if errors.Is(execCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
		return fmt.Errorf("The pre-backup command in %q was still running after 15 minutes.", pre.ServiceName)
	}
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("The pre-backup command in %q exited %d%s", pre.ServiceName, result.ExitCode,
			detail(result.Stdout+result.Stderr))
	}
	return nil
}

// detail trims output and, if long, keeps only its tail, for an error message.
func detail(output string) string {
	if tail := OutputTail(output); tail != "" {
		return ": " + tail
	}
	return "."
}

// OutputTail trims output and, if it's longer than outputTailChars, keeps only
// its tail prefixed with "...".
func OutputTail(output string) string {
	trimmed := []rune(strings.TrimSpace(output))
	if len(trimmed) > outputTailChars {
		return "..." + string(trimmed[len(trimmed)-outputTailChars:])
	}
	return string(trimmed)
}

// whileStopped stops services, runs work, then starts them again regardless
// of whether work or a stop failed, recording desired_state either way.
func whileStopped(ctx context.Context, job jobs.Job, docker *dockerapi.Client, services []Service, work func() error) error {
	restartCtx := context.WithoutCancel(ctx)
	return StopAround(services,
		func(service Service) error {
			setDesiredState(ctx, job, service.ID, "stopped")
			var err error
			if service.SwarmServiceID != "" {
				err = docker.ScaleSwarmService(ctx, service.SwarmServiceID, 0)
			} else {
				err = docker.StopContainer(ctx, service.ContainerID)
			}
			if err != nil {
				return fmt.Errorf("couldn't stop %q: %w", service.Name, err)
			}
			job.AppendLog(fmt.Sprintf("Stopped for a backup or restore: %s", service.Name))
			return nil
		},
		func(service Service) error {
			var err error
			if service.SwarmServiceID != "" {
				err = docker.ScaleSwarmService(restartCtx, service.SwarmServiceID, max(service.Replicas, 1))
			} else {
				err = docker.EnsureContainerStarted(restartCtx, service.ContainerID)
			}
			if err == nil {
				setDesiredState(restartCtx, job, service.ID, "running")
				job.AppendLog(fmt.Sprintf("Started again: %s", service.Name))
			}
			return err
		},
		func(service Service, err error) {
			job.AppendLog(fmt.Sprintf("Couldn't start %q again after a backup or restore: %s", service.Name, err))
		},
		work,
	)
}

// setDesiredState records the service's desired_state, logging but not
// failing the job when there's no database to write to or the write fails.
func setDesiredState(ctx context.Context, job jobs.Job, serviceID, state string) {
	if job.DB() == nil {
		return
	}
	if _, err := job.DB().Exec(ctx, `update service set desired_state = $2 where id = $1`, serviceID, state); err != nil {
		job.AppendLog(fmt.Sprintf("Couldn't record %s as %s: %s", serviceID, state, err))
	}
}

// StopAround stops every service, runs work, then starts every stopped
// service again regardless of whether work or a stop failed; onStartFailure
// reports a service that couldn't be restarted.
func StopAround[T any](services []T, stop, start func(T) error, onStartFailure func(T, error), work func() error) error {
	var stopped []T
	err := func() error {
		for _, service := range services {
			if err := stop(service); err != nil {
				return err
			}
			stopped = append(stopped, service)
		}
		return work()
	}()
	for _, service := range stopped {
		if startErr := start(service); startErr != nil {
			onStartFailure(service, startErr)
		}
	}
	return err
}
