package logship_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/logship"
)

func frame(stream byte, data string) []byte {
	header := make([]byte, 8)
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(data)))
	return append(header, data...)
}

func TestReadChunksRawStreamIsStdout(t *testing.T) {
	var chunks []logship.Chunk
	if err := logship.ReadChunks(strings.NewReader("hello\r\nworld\n"), func(c logship.Chunk) { chunks = append(chunks, c) }); err != nil {
		t.Fatal(err)
	}
	var all bytes.Buffer
	for _, c := range chunks {
		if c.Stream != "stdout" {
			t.Fatalf("stream = %q", c.Stream)
		}
		all.Write(c.Data)
	}
	if all.String() != "hello\r\nworld\n" {
		t.Fatalf("data = %q", all.String())
	}
}

func TestReadChunksFramedKeepsStreamsApart(t *testing.T) {
	input := append(frame(1, "out\n"), frame(2, "err\n")...)
	var got []string
	if err := logship.ReadChunks(bytes.NewReader(input), func(c logship.Chunk) { got = append(got, c.Stream+":"+string(c.Data)) }); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != "stdout:out\n|stderr:err\n" {
		t.Fatalf("got %q", got)
	}
}

func TestSplitterHoldsPartialLines(t *testing.T) {
	var s logship.Splitter
	var lines []string
	emit := func(stream, line string) { lines = append(lines, stream+":"+line) }
	s.Feed(logship.Chunk{Data: []byte("a\r\nb"), Stream: "stdout"}, emit)
	s.Feed(logship.Chunk{Data: []byte("c\n"), Stream: "stdout"}, emit)
	s.Feed(logship.Chunk{Data: []byte("tail"), Stream: "stderr"}, emit)
	s.Flush(emit)
	if strings.Join(lines, "|") != "stdout:a|stdout:bc|stderr:tail" {
		t.Fatalf("lines = %q", lines)
	}
}

func TestParseLine(t *testing.T) {
	parsed, ok := logship.ParseLine("2026-10-28T12:00:00.123456789Z listening on :80", false)
	if !ok || parsed.Text != "listening on :80" || parsed.Time.Nanosecond() != 123456000 {
		t.Fatalf("parsed = %+v ok=%v", parsed, ok)
	}
	parsed, ok = logship.ParseLine("2026-10-28T12:00:00Z com.docker.swarm.node.id=n1,com.docker.swarm.service.id=s1,com.docker.swarm.task.id=t1 boom", true)
	if !ok || parsed.TaskID != "t1" || parsed.Text != "boom" {
		t.Fatalf("parsed = %+v ok=%v", parsed, ok)
	}
	if _, ok := logship.ParseLine("no timestamp here", false); ok {
		t.Fatal("a line without a timestamp parsed")
	}
}

func TestClean(t *testing.T) {
	if got := logship.Clean("a\x00b\xffc"); got != "ab�c" {
		t.Fatalf("got %q", got)
	}
	long := strings.Repeat("é", logship.MaxLineBytes)
	if got := logship.Clean(long); len(got) > logship.MaxLineBytes || !strings.HasPrefix(long, got) {
		t.Fatalf("cut to %d bytes", len(got))
	}
}

func TestDeploymentAt(t *testing.T) {
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	deps := []logship.Deployment{{ID: "a", Since: base}, {ID: "b", Since: base.Add(time.Hour)}}
	cases := map[time.Duration]string{-time.Minute: "a", 0: "a", 30 * time.Minute: "a", time.Hour: "b", 2 * time.Hour: "b"}
	for offset, want := range cases {
		if got := logship.DeploymentAt(deps, base.Add(offset)); got != want {
			t.Errorf("at %s: got %q want %q", offset, got, want)
		}
	}
	if logship.DeploymentAt(nil, base) != "" {
		t.Error("no deployments should give no id")
	}
}

type fakeStore struct {
	mu        sync.Mutex
	workloads []logship.Workload
	last      time.Time
	lines     []logship.Line
}

func (f *fakeStore) Workloads(context.Context) ([]logship.Workload, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]logship.Workload(nil), f.workloads...), nil
}

func (f *fakeStore) RetentionDays(context.Context) (int, error) { return 7, nil }

func (f *fakeStore) LastTime(context.Context, string, string, bool) (time.Time, error) {
	return f.last, nil
}

func (f *fakeStore) Deployments(context.Context, string, string) ([]logship.Deployment, error) {
	return []logship.Deployment{{ID: "dep1", Since: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}}, nil
}

func (f *fakeStore) Insert(_ context.Context, lines []logship.Line) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lines = append(f.lines, lines...)
	return nil
}

func (f *fakeStore) stored() []logship.Line {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]logship.Line(nil), f.lines...)
}

type fakeDocker struct {
	mu     sync.Mutex
	output string
	since  []time.Time
}

func (d *fakeDocker) ContainerLogsSince(_ context.Context, _ string, since time.Time) (io.ReadCloser, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.since = append(d.since, since)
	return io.NopCloser(strings.NewReader(d.output)), nil
}

func (d *fakeDocker) SwarmServiceLogsSince(ctx context.Context, id string, since time.Time) (io.ReadCloser, error) {
	return d.ContainerLogsSince(ctx, id, since)
}

func TestShipperStoresNewLinesOnceAcrossReopens(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{
		last:      time.Date(2026, 10, 28, 11, 0, 0, 0, time.UTC),
		workloads: []logship.Workload{{ID: "0123456789abcdef", ServiceID: "svc"}},
	}
	docker := &fakeDocker{output: "2026-10-28T11:00:00Z already stored\n2026-10-28T11:00:01Z first\n2026-10-28T11:00:02Z second\n"}
	shipper := &logship.Shipper{
		Docker:        docker,
		FlushInterval: 5 * time.Millisecond,
		Interval:      time.Hour,
		MaxRetry:      10 * time.Millisecond,
		Now:           func() time.Time { return now },
		Retry:         5 * time.Millisecond,
		Store:         store,
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		shipper.Run(ctx)
		close(done)
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		docker.mu.Lock()
		opened := len(docker.since)
		docker.mu.Unlock()
		if opened >= 3 || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	<-done
	lines := store.stored()
	if len(lines) != 2 {
		t.Fatalf("stored %d lines, want 2: %+v", len(lines), lines)
	}
	if lines[0].Text != "first" || lines[1].Text != "second" {
		t.Fatalf("lines = %+v", lines)
	}
	if lines[0].Instance != "0123456789ab" || lines[0].DeploymentID != "dep1" || lines[0].Stream != "stdout" {
		t.Fatalf("line = %+v", lines[0])
	}
	docker.mu.Lock()
	defer docker.mu.Unlock()
	if !docker.since[0].Equal(store.last) {
		t.Fatalf("first open since %s, want %s", docker.since[0], store.last)
	}
}

func TestShipperStopsFollowingGoneWorkloads(t *testing.T) {
	store := &fakeStore{workloads: []logship.Workload{{ID: "c1", ServiceID: "svc"}}}
	shipper := &logship.Shipper{Docker: &fakeDocker{}, Retry: time.Hour, Store: store}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	shipper.Sync(ctx)
	if shipper.Following() != 1 {
		t.Fatalf("following %d", shipper.Following())
	}
	store.mu.Lock()
	store.workloads = nil
	store.mu.Unlock()
	shipper.Sync(ctx)
	if shipper.Following() != 0 {
		t.Fatalf("following %d after the workload went", shipper.Following())
	}
}
