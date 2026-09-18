package backup

import (
	"archive/tar"
	"context"
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
	"github.com/orochibraru/homerun/internal/dockersocket"
	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/s3"
)

type recorder struct {
	events        []string
	startFailures []string
	failStop      string
	failStart     string
}

func (r *recorder) run(services []string, work func() error) error {
	return stopAround(services,
		func(s string) error {
			if s == r.failStop {
				return fmt.Errorf("can't stop %s", s)
			}
			r.events = append(r.events, "stop:"+s)
			return nil
		},
		func(s string) error {
			r.events = append(r.events, "start:"+s)
			if s == r.failStart {
				return fmt.Errorf("can't start %s", s)
			}
			return nil
		},
		func(s string, _ error) { r.startFailures = append(r.startFailures, s) },
		work,
	)
}

func TestStopAroundStopsWorksAndStartsAgain(t *testing.T) {
	r := &recorder{}
	err := r.run([]string{"db", "api"}, func() error {
		r.events = append(r.events, "work")
		return nil
	})
	want := []string{"stop:db", "stop:api", "work", "start:db", "start:api"}
	if err != nil || !reflect.DeepEqual(r.events, want) {
		t.Fatalf("err=%v events=%v", err, r.events)
	}
}

func TestStopAroundStartsAgainWhenWorkFails(t *testing.T) {
	r := &recorder{}
	err := r.run([]string{"db"}, func() error { return errors.New("tar") })
	if err == nil || err.Error() != "tar" || !reflect.DeepEqual(r.events, []string{"stop:db", "start:db"}) {
		t.Fatalf("err=%v events=%v", err, r.events)
	}
}

func TestStopAroundFailedStopSkipsWork(t *testing.T) {
	r := &recorder{failStop: "api"}
	ran := false
	err := r.run([]string{"db", "api"}, func() error { ran = true; return nil })
	if err == nil || ran || !reflect.DeepEqual(r.events, []string{"stop:db", "start:db"}) {
		t.Fatalf("err=%v ran=%t events=%v", err, ran, r.events)
	}
}

func TestStopAroundReportsFailedStart(t *testing.T) {
	r := &recorder{failStart: "db"}
	if err := r.run([]string{"db", "api"}, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(r.startFailures, []string{"db"}) {
		t.Fatalf("start failures = %v", r.startFailures)
	}
}

func TestOutputTail(t *testing.T) {
	if got := outputTail("  done\n"); got != "done" {
		t.Fatalf("got %q", got)
	}
	tail := outputTail(strings.Repeat("a", 3000) + "END")
	if !strings.HasPrefix(tail, "...") || !strings.HasSuffix(tail, "END") || len(tail) != 2003 {
		t.Fatalf("tail len=%d", len(tail))
	}
}

func stubS3(t *testing.T) s3.Client {
	var mu sync.Mutex
	objects := map[string][]byte{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodPut:
			objects[r.URL.Path], _ = io.ReadAll(r.Body)
		case http.MethodGet:
			object, ok := objects[r.URL.Path]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write(object)
		}
	}))
	t.Cleanup(server.Close)
	return s3.Client{AccessKeyID: "k", Bucket: "b", Endpoint: server.URL, Region: "us-east-1", SecretAccessKey: "s"}
}

func volumeFiles(t *testing.T, docker *dockerapi.Client, spec Spec) []string {
	var names []string
	err := withHelper(context.Background(), docker, spec, true, func(id string) error {
		stream, err := docker.ContainerArchive(context.Background(), id, spec.MountPath+"/.")
		if err != nil {
			return err
		}
		defer stream.Close()
		reader := tar.NewReader(stream)
		for {
			header, err := reader.Next()
			if errors.Is(err, io.EOF) {
				return nil
			}
			if err != nil {
				return err
			}
			if header.Typeflag == tar.TypeReg {
				names = append(names, strings.TrimPrefix(header.Name, "./"))
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(names)
	return names
}

func runStep(t *testing.T, docker *dockerapi.Client, spec Spec, cmd string) {
	id, err := docker.CreateContainer(context.Background(), dockerapi.ContainerConfig{
		Binds: []string{spec.Source + ":" + spec.MountPath}, Cmd: []string{"sh", "-c", cmd}, Image: spec.HelperImage,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer docker.RemoveContainer(context.Background(), id)
	if err := docker.StartContainer(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if code, err := docker.WaitContainer(context.Background(), id); err != nil || code != 0 {
		t.Fatalf("%q: code=%d err=%v", cmd, code, err)
	}
}

func TestBackupAndRestoreRoundTripOnRealDocker(t *testing.T) {
	socket := dockersocket.Resolve("")
	docker := dockerapi.New(socket)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := docker.Ping(ctx); err != nil {
		t.Skipf("no Docker daemon: %v", err)
	}
	volume := fmt.Sprintf("homerun-backup-test-%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = docker.RemoveVolume(context.Background(), volume) })
	spec := Spec{
		Destination: stubS3(t), HelperImage: "alpine:3", Key: "p/" + volume + ".tar.gz",
		MountPath: "/homerun-backup-source", Source: volume, VolumeName: volume,
	}
	runStep(t, docker, spec, "echo hi > /homerun-backup-source/a.txt && mkdir /homerun-backup-source/sub && echo x > /homerun-backup-source/sub/b")

	job, lines, _ := jobs.Recorder("backup", spec)
	job.DockerSocket = socket
	result, err := Run(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	if result["key"] != spec.Key || result["sizeBytes"].(int64) <= 0 {
		t.Fatalf("result = %v", result)
	}

	runStep(t, docker, spec, "rm /homerun-backup-source/a.txt && echo y > /homerun-backup-source/extra")
	spec.Wipe = true
	job, _, _ = jobs.Recorder("backup_restore", spec)
	job.DockerSocket = socket
	if _, err := Run(ctx, job); err != nil {
		t.Fatal(err)
	}
	if got := volumeFiles(t, docker, spec); !reflect.DeepEqual(got, []string{"a.txt", "sub/b"}) {
		t.Fatalf("restored files = %v, log %v", got, lines())
	}
}
