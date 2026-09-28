package backup_test

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/jobs/backup"
	"github.com/orochibraru/homerun/internal/s3"
	"github.com/orochibraru/homerun/tests/unit/go/internal/testsupport"
)

type fakeContainer struct {
	bind    string
	cmd     []string
	code    int
	exited  chan struct{}
	labels  map[string]string
	started chan struct{}
}

// fakeEngine is a Docker daemon that runs helper containers' tar, find and
// failing commands against in-memory volumes, over a real hijacked attach.
type fakeEngine struct {
	mu         sync.Mutex
	containers map[string]*fakeContainer
	failTar    bool
	hang       bool
	removed    []string
	volumes    map[string]map[string]string
}

// ServeHTTP answers the handful of Engine endpoints a helper run uses.
func (e *fakeEngine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case path == "/_ping" || strings.HasPrefix(path, "/images/"):
		_, _ = io.WriteString(w, `{}`)
	case path == "/containers/create":
		e.create(w, r)
	case strings.HasSuffix(path, "/attach"):
		e.attach(w, e.container(path))
	case strings.HasSuffix(path, "/start"):
		close(e.container(path).started)
		w.WriteHeader(http.StatusNoContent)
	case strings.HasSuffix(path, "/wait"):
		c := e.container(path)
		<-c.exited
		_, _ = fmt.Fprintf(w, `{"StatusCode":%d}`, c.code)
	case strings.HasSuffix(path, "/json"):
		if e.hang {
			<-r.Context().Done()
			return
		}
		_, _ = io.WriteString(w, `{"State":{"Running":true}}`)
	case r.Method == http.MethodDelete:
		e.mu.Lock()
		e.removed = append(e.removed, strings.TrimPrefix(path, "/containers/"))
		e.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// container is the fake container a /containers/<id>/... path is about.
func (e *fakeEngine) container(path string) *fakeContainer {
	id := strings.Split(strings.TrimPrefix(path, "/containers/"), "/")[0]
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.containers[id]
}

// create records a helper's command, bind and labels.
func (e *fakeEngine) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cmd        []string                 `json:"Cmd"`
		HostConfig struct{ Binds []string } `json:"HostConfig"`
		Labels     map[string]string        `json:"Labels"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	e.mu.Lock()
	id := fmt.Sprintf("helper%d", len(e.containers)+1)
	e.containers[id] = &fakeContainer{
		bind: body.HostConfig.Binds[0], cmd: body.Cmd, exited: make(chan struct{}),
		labels: body.Labels, started: make(chan struct{}),
	}
	e.mu.Unlock()
	w.WriteHeader(http.StatusCreated)
	_, _ = fmt.Fprintf(w, `{"Id":%q}`, id)
}

// attach hijacks the connection and, once the container starts, runs its
// command: tar -c streams the volume out framed on stdout, tar -x reads it
// back in from stdin until the client half-closes, find wipes it.
func (e *fakeEngine) attach(w http.ResponseWriter, c *fakeContainer) {
	conn, buffered, err := w.(http.Hijacker).Hijack()
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()
	_, _ = buffered.WriteString("HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
	_ = buffered.Flush()
	<-c.started
	defer close(c.exited)
	if e.hang {
		time.Sleep(time.Second)
		return
	}
	source := strings.Split(c.bind, ":")[0]
	switch {
	case e.failTar && c.cmd[0] == "tar":
		_, _ = buffered.Write(testsupport.DockerFrame(2, "tar: can't open 'secret': Permission denied"))
		c.code = 1
	case strings.Contains(strings.Join(c.cmd, " "), "-cf"):
		_, _ = buffered.Write(testsupport.DockerFrame(1, e.pack(source)))
	case strings.Contains(strings.Join(c.cmd, " "), "-xf"):
		e.unpack(source, buffered)
	case c.cmd[0] == "find":
		e.mu.Lock()
		e.volumes[source] = map[string]string{}
		e.mu.Unlock()
	}
	_ = buffered.Flush()
}

// pack tars a volume's files the way `tar -C mount -cf - .` names them.
func (e *fakeEngine) pack(source string) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out bytes.Buffer
	writer := tar.NewWriter(&out)
	_ = writer.WriteHeader(&tar.Header{Name: "./", Typeflag: tar.TypeDir, Mode: 0o755})
	for name, content := range e.volumes[source] {
		_ = writer.WriteHeader(&tar.Header{Name: "./" + name, Mode: 0o644, Size: int64(len(content))})
		_, _ = writer.Write([]byte(content))
	}
	_ = writer.Close()
	return out.String()
}

// unpack reads a tar from stdin into a volume, over what's already there.
func (e *fakeEngine) unpack(source string, stdin io.Reader) {
	reader := tar.NewReader(stdin)
	e.mu.Lock()
	defer e.mu.Unlock()
	for {
		header, err := reader.Next()
		if err != nil {
			_, _ = io.Copy(io.Discard, stdin)
			return
		}
		if header.Typeflag == tar.TypeReg {
			content, _ := io.ReadAll(reader)
			e.volumes[source][strings.TrimPrefix(header.Name, "./")] = string(content)
		}
	}
}

// files lists a volume's file names, sorted.
func (e *fakeEngine) files(source string) []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	var names []string
	for name := range e.volumes[source] {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// newFakeEngine serves a fakeEngine holding volume "data" on a unix socket.
func newFakeEngine(t *testing.T, files map[string]string) (*fakeEngine, string) {
	engine := &fakeEngine{containers: map[string]*fakeContainer{}, volumes: map[string]map[string]string{"data": files}}
	return engine, testsupport.ServeUnixSocket(t, engine)
}

// fakeSpec is a backup of volume "data" to an in-memory S3.
func fakeSpec(t *testing.T) backup.Spec {
	return backup.Spec{
		Destination: stubS3(t), HelperImage: "alpine:3", HelperLabels: map[string]string{"homerun.volume": "data"},
		Key: "p/data.tar.gz", MountPath: "/homerun-backup-source", Source: "data", VolumeName: "data",
	}
}

// runJob runs a backup or backup_restore job against socket.
func runJob(t *testing.T, jobType, socket string, spec backup.Spec) (map[string]any, error) {
	job, _, err := jobs.Recorder(jobType, spec)
	if err != nil {
		t.Fatal(err)
	}
	job.DockerSocket = socket
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return backup.Run(ctx, job)
}

func TestBackupStreamsTarOutOfAStartedHelperAndRestoresThroughItsStdin(t *testing.T) {
	engine, socket := newFakeEngine(t, map[string]string{"a.txt": "hi", "sub/b": "x"})
	spec := fakeSpec(t)

	result, err := runJob(t, "backup", socket, spec)
	if err != nil {
		t.Fatal(err)
	}
	if result["key"] != spec.Key || result["sizeBytes"].(int64) <= 0 {
		t.Fatalf("result = %v", result)
	}
	for id, c := range engine.containers {
		if c.labels[dockerapi.HelperLabel] != "true" || c.labels["homerun.volume"] != "data" || c.labels[dockerapi.HelperCreatedLabel] == "" {
			t.Errorf("helper %s must carry the helper labels and the spec's own, got %v", id, c.labels)
		}
		if !strings.HasSuffix(c.bind, ":ro") {
			t.Errorf("the backup helper must mount the volume read-only, got %s", c.bind)
		}
	}

	engine.mu.Lock()
	engine.volumes["data"] = map[string]string{"stray": "y"}
	engine.mu.Unlock()
	spec.Wipe = true
	if _, err := runJob(t, "backup_restore", socket, spec); err != nil {
		t.Fatal(err)
	}
	if got := engine.files("data"); !reflect.DeepEqual(got, []string{"a.txt", "sub/b"}) {
		t.Fatalf("restored files = %v", got)
	}
	if len(engine.removed) != len(engine.containers) {
		t.Errorf("every helper must be removed, created %d removed %v", len(engine.containers), engine.removed)
	}
}

func TestAFailedTarFailsTheBackupWithItsStderrAndUploadsNothing(t *testing.T) {
	engine, socket := newFakeEngine(t, map[string]string{"secret": "s"})
	engine.failTar = true
	spec := fakeSpec(t)

	_, err := runJob(t, "backup", socket, spec)
	if err == nil || !strings.Contains(err.Error(), "Permission denied") || !strings.Contains(err.Error(), "tar exited 1") {
		t.Fatalf("want tar's own error, got %v", err)
	}
	if object, err := spec.Destination.Get(context.Background(), spec.Key); err == nil {
		_ = object.Close()
		t.Fatal("a failed archive must not be uploaded")
	}
}

func TestABackupOnAWedgedContainerFailsInsteadOfHanging(t *testing.T) {
	restore := dockerapi.ControlTimeout
	restoreStall := dockerapi.StallTimeout
	dockerapi.ControlTimeout, dockerapi.StallTimeout = 50*time.Millisecond, 200*time.Millisecond
	t.Cleanup(func() { dockerapi.ControlTimeout, dockerapi.StallTimeout = restore, restoreStall })

	engine, socket := newFakeEngine(t, map[string]string{"a.txt": "hi"})
	engine.hang = true
	started := time.Now()
	_, err := runJob(t, "backup", socket, fakeSpec(t))
	var stall *dockerapi.StallError
	if !errors.As(err, &stall) || stall.Container != "helper1" {
		t.Fatalf("want a StallError naming the helper, got %v", err)
	}
	if !strings.Contains(err.Error(), "sudo systemctl restart docker") {
		t.Errorf("the error must say how to clear a wedged daemon, got %v", err)
	}
	if took := time.Since(started); took > 5*time.Second {
		t.Fatalf("the stall must be detected within the window, took %s", took)
	}
}

func TestAFailedUploadReportsTheS3ErrorNotTheBrokenPipe(t *testing.T) {
	previous := s3.RetryDelay
	s3.RetryDelay = func(int) time.Duration { return 0 }
	t.Cleanup(func() { s3.RetryDelay = previous })
	noise := make([]byte, s3.PartSize+s3.PartSize/2)
	_, _ = rand.Read(noise)
	_, socket := newFakeEngine(t, map[string]string{"big": string(noise)})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("uploads") {
			_, _ = io.WriteString(w, "<InitiateMultipartUploadResult><UploadId>u</UploadId></InitiateMultipartUploadResult>")
			return
		}
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusGatewayTimeout)
	}))
	t.Cleanup(server.Close)
	spec := fakeSpec(t)
	spec.Destination = s3.Client{Bucket: "b", Endpoint: server.URL, Region: "us-east-1"}

	_, err := runJob(t, "backup", socket, spec)
	if err == nil || !strings.Contains(err.Error(), "504") || strings.Contains(err.Error(), "stopped reading") {
		t.Fatalf("want the S3 504, got %v", err)
	}
}
