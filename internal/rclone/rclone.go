// Package rclone moves a backup archive to and from a destination S3 doesn't
// cover (SFTP, SMB, WebDAV: a Hetzner Storage Box, a NAS) by running rclone
// in a throwaway helper container. The app resolves which image, entrypoint
// and environment reach the destination; this side only streams through it.
package rclone

import (
	"context"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
)

const (
	cleanupTimeout = time.Minute
	errorTailChars = 2000
	partialSuffix  = ".partial"
	progressEvery  = 30 * time.Second
	remoteName     = "dest:"
	mebibyte       = 1 << 20
)

// Remote is one destination reached through an rclone helper container whose
// Env configures a remote named "dest", with Path the directory under it.
type Remote struct {
	Entrypoint []string          `json:"entrypoint"`
	Env        map[string]string `json:"env"`
	Image      string            `json:"image"`
	Label      string            `json:"label"`
	Path       string            `json:"path"`

	Docker *dockerapi.Client `json:"-"`
	Labels map[string]string `json:"-"`
	Log    func(string)      `json:"-"`
}

// Target is key's rclone path under the remote.
func (r *Remote) Target(key string) string {
	return remoteName + path.Join(r.Path, key)
}

// environment renders Env as sorted KEY=value pairs.
func (r *Remote) environment() []string {
	pairs := make([]string, 0, len(r.Env))
	for name, value := range r.Env {
		pairs = append(pairs, name+"="+value)
	}
	sort.Strings(pairs)
	return pairs
}

// run executes one rclone command in a helper container, failing on a
// non-zero exit with the tail of what rclone wrote to stderr.
func (r *Remote) run(ctx context.Context, stdin io.Reader, stdout io.Writer, args ...string) error {
	result, err := r.Docker.RunHelper(ctx, dockerapi.HelperConfig{
		Cmd:        args,
		Entrypoint: r.Entrypoint,
		Env:        r.environment(),
		Image:      r.Image,
		Labels:     r.Labels,
		Stdin:      stdin,
		Stdout:     stdout,
	})
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		detail := []rune(strings.TrimSpace(result.Stderr))
		if len(detail) > errorTailChars {
			detail = detail[len(detail)-errorTailChars:]
		}
		return fmt.Errorf("rclone %s exited %d: %s", args[0], result.ExitCode, string(detail))
	}
	return nil
}

// Upload streams body to key and returns how many bytes it stored. The
// archive lands under a ".partial" name and is renamed once it's complete, so
// a failed run never leaves a truncated archive under the real key.
func (r *Remote) Upload(ctx context.Context, key string, body io.Reader) (int64, error) {
	counted := &progress{log: r.Log, source: body, started: time.Now(), lastLog: time.Now()}
	partial := r.Target(key) + partialSuffix
	err := r.run(ctx, counted, nil, "rcat", "--retries", "1", partial)
	if err == nil {
		err = r.run(ctx, nil, nil, "moveto", partial, r.Target(key))
	}
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
		defer cancel()
		_ = r.run(cleanupCtx, nil, nil, "deletefile", partial)
		return 0, err
	}
	return counted.sent, nil
}

// Get opens key for reading. The caller closes the stream.
func (r *Remote) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	reader, writer := io.Pipe()
	go func() {
		_ = writer.CloseWithError(r.run(ctx, nil, writer, "cat", r.Target(key)))
	}()
	return reader, nil
}

// progress counts the bytes read from an upload's body and logs the
// throughput at most every progressEvery.
type progress struct {
	lastLog time.Time
	log     func(string)
	sent    int64
	source  io.Reader
	started time.Time
}

// Read reads from the source, counting and logging as it goes.
func (p *progress) Read(buffer []byte) (int, error) {
	n, err := p.source.Read(buffer)
	p.sent += int64(n)
	if p.log != nil && time.Since(p.lastLog) >= progressEvery {
		p.lastLog = time.Now()
		elapsed := time.Since(p.started)
		p.log(fmt.Sprintf("Uploaded %.1f MiB (%.1f MiB/s over %s)", float64(p.sent)/mebibyte,
			float64(p.sent)/mebibyte/max(elapsed.Seconds(), 0.001), elapsed.Round(time.Second)))
	}
	return n, err
}
