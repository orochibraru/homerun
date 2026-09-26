// Package activity tracks whether a job is still making progress. The worker
// puts a Tracker in each job's context; the Docker client, the S3 client and
// the executors touch it whenever bytes move or a call answers, and the
// worker's no-progress watchdog reads how long it has been since the last
// touch. A heartbeat only proves the worker process is alive, this proves the
// job is.
package activity

import (
	"context"
	"io"
	"sync/atomic"
	"time"
)

// Tracker records the last moment a job made progress.
type Tracker struct {
	holds atomic.Int32
	last  atomic.Int64
}

type key struct{}

// NewTracker returns a Tracker whose last progress is now.
func NewTracker() *Tracker {
	tracker := &Tracker{}
	tracker.touch()
	return tracker
}

// touch records progress now.
func (t *Tracker) touch() {
	t.last.Store(time.Now().UnixNano())
}

// Last is the last moment progress was recorded, or now while a Hold is open.
func (t *Tracker) Last() time.Time {
	if t.holds.Load() > 0 {
		return time.Now()
	}
	return time.Unix(0, t.last.Load())
}

// With returns ctx carrying tracker, for Touch, Hold and Reader to find.
func With(ctx context.Context, tracker *Tracker) context.Context {
	return context.WithValue(ctx, key{}, tracker)
}

// from returns the Tracker ctx carries, or nil.
func from(ctx context.Context) *Tracker {
	tracker, _ := ctx.Value(key{}).(*Tracker)
	return tracker
}

// Touch records progress on ctx's Tracker, if it carries one.
func Touch(ctx context.Context) {
	if tracker := from(ctx); tracker != nil {
		tracker.touch()
	}
}

// Hold marks ctx's job as busy on something that is bounded by its own
// timeout but reports nothing while it runs (a remote build answered in one
// response), until the returned release is called.
func Hold(ctx context.Context) func() {
	tracker := from(ctx)
	if tracker == nil {
		return func() {}
	}
	tracker.holds.Add(1)
	return func() {
		tracker.touch()
		tracker.holds.Add(-1)
	}
}

type reader struct {
	ctx    context.Context
	source io.Reader
}

// Read reads from the source, touching the Tracker when bytes arrive.
func (r reader) Read(buffer []byte) (int, error) {
	n, err := r.source.Read(buffer)
	if n > 0 {
		Touch(r.ctx)
	}
	return n, err
}

// Reader wraps source so every read that returns bytes counts as progress.
func Reader(ctx context.Context, source io.Reader) io.Reader {
	if from(ctx) == nil {
		return source
	}
	return reader{ctx: ctx, source: source}
}
