package workerapi

import (
	"net/http"
	"time"
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
