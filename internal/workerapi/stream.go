package workerapi

import (
	"bytes"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
)

// noDeadline is the zero time, which clears a connection's write deadline. A
// followed log stream or an open terminal is idle most of the time and must
// not be cut off for it.
var noDeadline = time.Time{}

// flushWriter pushes every write straight out to the client instead of letting
// it sit in Go's response buffer, which is what makes a followed log or a
// terminal feel live rather than arriving in 4KB batches.
type flushWriter struct {
	controller *http.ResponseController
	writer     http.ResponseWriter
}

// Write forwards a chunk and flushes it.
func (f *flushWriter) Write(chunk []byte) (int, error) {
	written, err := f.writer.Write(chunk)
	if err != nil {
		return written, err
	}
	return written, f.controller.Flush()
}

// taskStream is one swarm task's log stream and the label its lines get.
type taskStream struct {
	logs   io.Reader
	prefix string
}

// prefixWriter writes whole lines, each one prefixed, to a writer shared by
// several streams: a line from one task never lands in the middle of another's.
type prefixWriter struct {
	mu      *sync.Mutex
	out     io.Writer
	prefix  string
	pending []byte
}

// Write buffers a chunk and writes out every complete line in it.
func (p *prefixWriter) Write(chunk []byte) (int, error) {
	p.pending = append(p.pending, chunk...)
	for {
		end := bytes.IndexByte(p.pending, '\n')
		if end < 0 {
			return len(chunk), nil
		}
		if err := p.emit(p.pending[:end+1]); err != nil {
			return 0, err
		}
		p.pending = p.pending[end+1:]
	}
}

// Flush writes out a last line that had no trailing newline.
func (p *prefixWriter) Flush() error {
	if len(p.pending) == 0 {
		return nil
	}
	p.pending = append(p.pending, '\n')
	line := p.pending
	p.pending = nil
	return p.emit(line)
}

// emit writes one line under the shared lock.
func (p *prefixWriter) emit(line []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, err := p.out.Write(append([]byte(p.prefix), line...))
	return err
}

// streamTasks demuxes several task log streams into the response at once, as
// plain text, until every one of them ends.
func streamTasks(w http.ResponseWriter, r *http.Request, streams []taskStream) error {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	controller := http.NewResponseController(w)
	_ = controller.SetWriteDeadline(noDeadline)
	shared := &flushWriter{controller: controller, writer: w}
	lock := &sync.Mutex{}
	var group sync.WaitGroup
	for _, stream := range streams {
		group.Add(1)
		go func() {
			defer group.Done()
			writer := &prefixWriter{mu: lock, out: shared, prefix: stream.prefix}
			if err := dockerapi.DemuxAuto(stream.logs, writer); err != nil && r.Context().Err() == nil {
				_ = writer.emit([]byte("log stream failed: " + err.Error() + "\n"))
			}
			_ = writer.Flush()
		}()
	}
	group.Wait()
	return nil
}
